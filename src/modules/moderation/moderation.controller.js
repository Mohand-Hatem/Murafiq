import moderationEventRepository from './moderation-event.repository.js';
import blockedDomainRepository from './blocked-domain.repository.js';
import blockedWordRepository from './blocked-word.repository.js';
import moderationService from './moderation.service.js';

export const getEvents = asyncHandler(async (req, res) => {
  const { page, limit, reviewStatus, severity, senderId } = req.query;
  const filter = {};
  if (reviewStatus) filter.reviewStatus = reviewStatus;
  if (severity) filter.severity = severity;
  if (senderId) filter.senderId = senderId;

  const result = await moderationEventRepository.findPaginated(filter, { page, limit });
  return ApiResponse.success(res, {
    message: 'Moderation events retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const getBlockedDomains = asyncHandler(async (req, res) => {
  const domains = await blockedDomainRepository.findAllActive();
  return ApiResponse.success(res, {
    message: 'Blocked domains retrieved successfully',
    data: domains,
  });
});

export const addBlockedDomain = asyncHandler(async (req, res) => {
  const domainDoc = await blockedDomainRepository.create({
    domain: req.body.domain,
    category: req.body.category || 'external_communication',
    addedBy: req.user.id || req.user._id,
  });

  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Domain added to blocklist successfully',
    data: domainDoc,
  });
});

export const deleteBlockedDomain = asyncHandler(async (req, res) => {
  await blockedDomainRepository.deleteById(req.params.id);
  return ApiResponse.success(res, {
    message: 'Domain removed from blocklist successfully',
  });
});

export const getBlockedWords = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, language, category, severity, isActive } = req.query;
  const filter = {};
  if (language) filter.language = language;
  if (category) filter.category = category;
  if (severity) filter.severity = severity;
  if (isActive !== undefined) filter.isActive = isActive;

  const skip = (Number(page) - 1) * Number(limit);
  const { items, total } = await blockedWordRepository.findAllPaginated({
    query: filter,
    skip,
    limit: Number(limit),
  });

  return ApiResponse.success(res, {
    message: 'Blocked words retrieved successfully',
    data: items,
    meta: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const addBlockedWord = asyncHandler(async (req, res) => {
  const adminId = (req.user?._id || req.user?.id || req.user?.sub)?.toString();
  const wordDoc = await blockedWordRepository.create({
    word: req.body.word,
    language: req.body.language || 'both',
    category: req.body.category || 'PROFANITY',
    severity: req.body.severity || 'MEDIUM',
    addedBy: adminId,
  });

  moderationService.invalidateBlockedWordsCache();

  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Word added to blocklist successfully',
    data: wordDoc,
  });
});

export const addBlockedWordsBulk = asyncHandler(async (req, res) => {
  const adminId = (req.user?._id || req.user?.id || req.user?.sub)?.toString();
  const wordsToInsert = req.body.words.map((item) => ({
    word: item.word.toLowerCase().trim(),
    language: item.language || 'both',
    category: item.category || 'PROFANITY',
    severity: item.severity || 'MEDIUM',
    addedBy: adminId,
  }));

  const docs = await blockedWordRepository.createMany(wordsToInsert);

  moderationService.invalidateBlockedWordsCache();

  return ApiResponse.success(res, {
    statusCode: 201,
    message: `${docs.length} words added to blocklist successfully`,
    data: docs,
  });
});

export const deleteBlockedWord = asyncHandler(async (req, res) => {
  await blockedWordRepository.deleteById(req.params.id);

  moderationService.invalidateBlockedWordsCache();

  return ApiResponse.success(res, {
    message: 'Word removed from blocklist successfully',
  });
});

export const forgiveViolationStrike = asyncHandler(async (req, res) => {
  const updated = await moderationService.forgiveStrike(req.params.id, req.user.id || req.user._id);
  return ApiResponse.success(res, {
    message: 'Policy violation strike forgiven successfully',
    data: updated,
  });
});

export const confirmEvent = asyncHandler(async (req, res) => {
  const reviewerId = (req.user?._id || req.user?.id || req.user?.sub)?.toString();
  const updated = await moderationService.confirmEvent(req.params.id, reviewerId, req.body?.notes);
  return ApiResponse.success(res, {
    message: 'Moderation event confirmed successfully',
    data: updated,
  });
});

export const overturnEvent = asyncHandler(async (req, res) => {
  const reviewerId = (req.user?._id || req.user?.id || req.user?.sub)?.toString();
  const updated = await moderationService.overturnEvent(req.params.id, reviewerId, req.body?.notes);
  return ApiResponse.success(res, {
    message: 'Moderation event overturned successfully',
    data: updated,
  });
});

export default {
  getEvents,
  getBlockedDomains,
  addBlockedDomain,
  deleteBlockedDomain,
  getBlockedWords,
  addBlockedWord,
  addBlockedWordsBulk,
  deleteBlockedWord,
  forgiveViolationStrike,
  confirmEvent,
  overturnEvent,
};
