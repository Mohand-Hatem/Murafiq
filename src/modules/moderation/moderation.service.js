import { scanText } from './moderation.scanner.js';
import blockedDomainRepository from './blocked-domain.repository.js';
import blockedWordRepository from './blocked-word.repository.js';
import moderationEventRepository from './moderation-event.repository.js';
import policyViolationRepository from './policy-violation.repository.js';
import userRepository from '../users/user.repository.js';
import eventBus from '../../common/events/event-bus.js';
import env from '../../config/env.config.js';
import ApiError from '../../common/utils/ApiError.js';
import logger from '../../config/logger.config.js';
import { invalidate as invalidateTokenVersion } from '../../common/utils/tokenVersionCache.js';
import bookingRepository from '../bookings/booking.repository.js';

let cachedBlockedWords = null;
let wordsCacheExpiresAt = 0;
const WORDS_CACHE_TTL_MS = 2 * 60 * 1000;

export const getActiveBlockedWords = async () => {
  const now = Date.now();
  if (cachedBlockedWords && wordsCacheExpiresAt > now) {
    return cachedBlockedWords;
  }
  try {
    cachedBlockedWords = await blockedWordRepository.findAllActiveWords();
    wordsCacheExpiresAt = now + WORDS_CACHE_TTL_MS;
    return cachedBlockedWords;
  } catch (err) {
    logger.warn(`Failed to load blocked words for scan: ${err.message}`);
    return cachedBlockedWords || [];
  }
};

export const invalidateBlockedWordsCache = () => {
  cachedBlockedWords = null;
  wordsCacheExpiresAt = 0;
};

/**
 * The shared 3-strike escalation ladder: records a PolicyViolation and, at strike 2/3,
 * actually restricts or suspends the account (bumping tokenVersion so it takes effect on
 * the very next request, not the next token refresh). Used by both the automated scanner
 * (`scanAndEnforce`, ENFORCE mode) and admin-confirmed user reports (`confirmEvent`) --
 * previously `confirmEvent` recorded nothing and applied no enforcement action at all,
 * so a human confirming a report as a real violation had no more effect than dismissing
 * it. See docs/AUDIT_2026_09_FULL_SYSTEM.md finding X11.
 *
 * @returns {Promise<{ strikeNumber: number, action: 'WARN'|'RESTRICT'|'SUSPEND' }|null>}
 *   null if recording the strike itself failed (logged, never thrown -- a moderation
 *   bookkeeping failure must not be the reason the original request/report fails).
 */
const applyStrikeEscalation = async (userId, { violationType, moderationEventId }) => {
  try {
    const activeStrikes = await policyViolationRepository.countActiveByUserId(userId);
    const strikeNumber = activeStrikes + 1;
    const action = strikeNumber >= 3 ? 'SUSPEND' : strikeNumber === 2 ? 'RESTRICT' : 'WARN';

    await policyViolationRepository.create({
      userId,
      violationType,
      severity: strikeNumber >= 3 ? 'CRITICAL' : strikeNumber === 2 ? 'HIGH' : 'MEDIUM',
      enforcementAction: action,
      moderationEventId: moderationEventId || undefined,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day strike window
    });

    if (action === 'SUSPEND') {
      // Bump tokenVersion and clear the refresh token, then drop the cache entry:
      // a suspension that leaves the offender's access token working for another
      // 15 minutes is not an enforcement action. See §I.4 step 4.
      await userRepository.updateById(userId, {
        accountStatus: 'suspended',
        sessions: [], // revoke every device's refresh session
        $inc: { tokenVersion: 1 },
      });
      invalidateTokenVersion(userId);
      logger.warn(`User ${userId} suspended automatically after 3 moderation strikes.`);
    } else if (action === 'RESTRICT') {
      // Chat-restricted, existing bookings honoured. Sessions still die so the
      // restriction takes effect immediately rather than on next token refresh.
      await userRepository.updateById(userId, {
        accountStatus: 'restricted',
        chatRestrictedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        $inc: { tokenVersion: 1 },
      });
      invalidateTokenVersion(userId);
      logger.warn(`User ${userId} chat-restricted after ${strikeNumber} moderation strikes.`);
    }

    return { strikeNumber, action };
  } catch (strikeErr) {
    logger.error(`Failed to record policy violation strike: ${strikeErr.message}`);
    return null;
  }
};

/**
 * Scans content synchronously for off-platform contact, URLs, and payment evasion.
 * Executes 3-strike escalation under ENFORCE mode or shadow logging under DRY_RUN mode.
 *
 * @param {string} userId - User authoring the content
 * @param {string} contentType - Context ('REQUEST' | 'OFFER' | 'MESSAGE' | 'PROFILE')
 * @param {string} text - Raw text to scan
 * @param {object} [context={}] - Metadata (conversationId, requestId, recipientId)
 * @returns {Promise<{ isAllowed: boolean, flagged: boolean, eventId?: string }>}
 */
export const scanAndEnforce = async (userId, contentType, text, context = {}) => {
  if (!text || typeof text !== 'string') {
    return { isAllowed: true, flagged: false };
  }

  let blockedDomains = [];
  try {
    blockedDomains = await blockedDomainRepository.findAllActiveDomains();
  } catch (err) {
    logger.warn(`Failed to load blocked domains for scan: ${err.message}`);
  }

  let blockedWords = [];
  try {
    blockedWords = await getActiveBlockedWords();
  } catch (err) {
    logger.warn(`Failed to load blocked words for scan: ${err.message}`);
  }

  const scanResult = scanText(text, blockedDomains, blockedWords);
  if (!scanResult.isFlagged) {
    return { isAllowed: true, flagged: false };
  }

  const mode = env.MODERATION_MODE || 'DRY_RUN';
  const actionTaken = mode === 'ENFORCE' ? 'BLOCK_ONLY' : 'OBSERVED';
  const severity = scanResult.severity || 'MEDIUM';

  let eventDoc;
  try {
    eventDoc = await moderationEventRepository.create({
      conversationId: context.conversationId || context.requestId || 'general_content',
      senderId: userId,
      recipientId: context.recipientId || undefined,
      messageSnippet: text.substring(0, 300),
      matchedLayer: scanResult.matchedLayer || 'REGEX_CONTACT',
      matchedRule: scanResult.matchedRule || 'DETECTED_OFF_PLATFORM_PATTERN',
      severity,
      actionTaken,
    });
  } catch (logErr) {
    logger.error(`Failed to create ModerationEvent log: ${logErr.message}`);
  }

  if (mode === 'ENFORCE') {
    await applyStrikeEscalation(userId, {
      violationType: 'CONTACT_EXCHANGE',
      moderationEventId: eventDoc?._id,
    });

    throw new ApiError(
      422,
      'Content violation: Sharing direct contact info, external links, or off-platform payment details is not permitted.'
    );
  }

  // DRY_RUN mode: emit audit event and let content pass
  if (eventDoc) {
    eventBus.emit('MODERATION_EVENT_FLAGGED', {
      eventId: eventDoc._id.toString(),
      userId,
      contentType,
    });
  }

  return {
    isAllowed: true,
    flagged: true,
    eventId: eventDoc?._id?.toString(),
  };
};

/**
 * A viewer-initiated report of a message.
 *
 * This is not an optional extra. With `MODERATION_PROVIDER=none` the automated layers
 * are deterministic string matching — strong on contact details and blocked domains,
 * but effectively blind to threats, insults and harassment, which depend on phrasing
 * rather than vocabulary. Human reporting is the only cover for that gap, so this path
 * carries real weight and must reach an admin queue rather than a log line.
 *
 * A report never enforces on its own: it records a PENDING event for review. Letting one
 * user's accusation restrict another automatically would just hand every user a weapon.
 */
export const reportContent = async (reporterId, { conversationId, messageId, reportedUserId, reason, snippet }) => {
  if (!conversationId || !reportedUserId) {
    throw new ApiError(400, 'A report must identify the conversation and the reported user');
  }
  if (String(reportedUserId) === String(reporterId)) {
    throw new ApiError(400, 'You cannot report yourself');
  }

  // Both parties must actually be participants of this conversation. Without this,
  // any authenticated user could file a USER_REPORT against an arbitrary stranger on an
  // arbitrary conversation id -- a false-accusation and admin-queue-flooding vector
  // (varying messageId defeats the duplicate-report guard below). conversationId is
  // always a bookingId (chat.service.js: "conversationId === bookingId"), so the
  // booking's own client/stylist pair IS the conversation's participant list -- reading
  // it via the repository avoids pulling the Firestore-backed chat service (and its
  // Firebase Admin init) into a module that otherwise has no chat dependency.
  // See docs/AUDIT_2026_09_FULL_SYSTEM.md finding X13.
  const conversationBooking = await bookingRepository.findById(conversationId);
  if (!conversationBooking) {
    throw new ApiError(404, 'Conversation not found');
  }
  const participantIds = [
    (conversationBooking.clientId?._id || conversationBooking.clientId).toString(),
    (conversationBooking.stylistId?._id || conversationBooking.stylistId).toString(),
  ];
  if (
    !participantIds.includes(String(reporterId)) ||
    !participantIds.includes(String(reportedUserId))
  ) {
    throw new ApiError(
      403,
      'You can only report another participant of a conversation you are part of'
    );
  }

  // One open report per reporter per message — stops a single user from flooding the
  // review queue by tapping report repeatedly.
  const existing = await moderationEventRepository.findOpenUserReport?.(
    reporterId,
    conversationId,
    messageId
  );
  if (existing) {
    return { reported: true, eventId: existing._id.toString(), duplicate: true };
  }

  const eventDoc = await moderationEventRepository.create({
    conversationId: String(conversationId),
    senderId: reportedUserId,
    recipientId: reporterId,
    messageSnippet: (snippet || reason || '').substring(0, 300),
    matchedLayer: 'USER_REPORT',
    matchedRule: messageId ? `user_report:${messageId}` : 'user_report',
    severity: 'MEDIUM',
    actionTaken: 'OBSERVED',
    reviewStatus: 'PENDING',
  });

  eventBus.emit('MODERATION_EVENT_FLAGGED', {
    eventId: eventDoc._id.toString(),
    userId: reportedUserId,
    contentType: 'USER_REPORT',
  });

  logger.info(`User ${reporterId} reported ${reportedUserId} in conversation ${conversationId}`);
  return { reported: true, eventId: eventDoc._id.toString(), duplicate: false };
};

export const forgiveStrike = async (violationId, adminUserId) => {
  const violation = await policyViolationRepository.findById(violationId);
  if (!violation) {
    throw new ApiError(404, 'Policy violation record not found');
  }

  const updated = await policyViolationRepository.updateById(violationId, {
    status: 'RESOLVED',
    resolvedBy: adminUserId,
    resolvedAt: new Date(),
  });

  return updated;
};

/**
 * Admin confirms a flagged/reported event was a genuine violation. Two things this used
 * to fail to do: (1) it wrote `reviewOutcome`, a field that does not exist on
 * `ModerationEvent` (the real field is `reviewStatus`), so Mongoose's strict mode
 * silently dropped the write and the event stayed 'PENDING' forever -- the admin queue
 * never cleared, and a dismissed-then-resolved report could never be re-filed by the
 * same reporter, since the anti-flood dedup also keys on `reviewStatus: 'PENDING'`.
 * (2) confirming had no effect on the reported user at all. Both are fixed here. See
 * docs/AUDIT_2026_09_FULL_SYSTEM.md finding X11.
 */
export const confirmEvent = async (eventId, reviewerId, notes = '') => {
  const event = await moderationEventRepository.findById(eventId);
  if (!event) {
    throw new ApiError(404, 'Moderation event not found');
  }
  if (event.reviewStatus !== 'PENDING') {
    throw new ApiError(409, `This event has already been reviewed (${event.reviewStatus})`);
  }

  const updated = await moderationEventRepository.updateById(eventId, {
    reviewStatus: 'APPROVED',
    reviewedBy: reviewerId,
    reviewedAt: new Date(),
    reviewNotes: notes,
  });

  // A confirmed report is now a real, human-verified violation -- apply the same
  // escalation ladder the automated scanner uses. Reports are subjective (harassment,
  // threats) rather than the pattern-matched contact/payment evasion the scanner
  // catches, hence the different violationType.
  // senderId holds the accused user for BOTH shapes of event: the content author for an
  // automated scan, and reportContent's `reportedUserId` for a user report (see :210).
  if (event.senderId) {
    await applyStrikeEscalation(event.senderId.toString(), {
      violationType: event.matchedLayer === 'USER_REPORT' ? 'HARASSMENT' : 'CONTACT_EXCHANGE',
      moderationEventId: event._id,
    });
  }

  return updated;
};

export const overturnEvent = async (eventId, reviewerId, notes = '') => {
  const event = await moderationEventRepository.findById(eventId);
  if (!event) {
    throw new ApiError(404, 'Moderation event not found');
  }
  if (event.reviewStatus !== 'PENDING') {
    throw new ApiError(409, `This event has already been reviewed (${event.reviewStatus})`);
  }

  const updated = await moderationEventRepository.updateById(eventId, {
    reviewStatus: 'DISMISSED',
    reviewedBy: reviewerId,
    reviewedAt: new Date(),
    reviewNotes: notes,
  });

  return updated;
};

export default {
  scanAndEnforce,
  reportContent,
  forgiveStrike,
  confirmEvent,
  overturnEvent,
  getActiveBlockedWords,
  invalidateBlockedWordsCache,
};
