import { firestore, auth } from '../../config/firebase.config.js';
import bookingRepository from '../bookings/booking.repository.js';
import moderationService from '../moderation/moderation.service.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import logger from '../../config/logger.config.js';

// In-memory fallback for local development or testing when live Firebase credentials are not connected
const mockConversations = new Map();
const mockMessages = new Map();

class ChatService {
  /**
   * Create a new conversation doc 1:1 with bookingId (created closed, unlocked upon payment)
   */
  async createConversation(bookingId, participants = []) {
    const stringId = String(bookingId);
    const participantIds = participants.map((p) => String(p));

    const conversationData = {
      bookingId: stringId,
      participants: participantIds,
      isOpen: false,
      isLocked: false,
      lastMessageAt: null,
      createdAt: new Date().toISOString(),
    };

    if (firestore) {
      await firestore.collection('conversations').doc(stringId).set(conversationData, { merge: true });
    } else {
      mockConversations.set(stringId, { ...conversationData });
      if (!mockMessages.has(stringId)) {
        mockMessages.set(stringId, []);
      }
    }

    return conversationData;
  }

  /**
   * Open a conversation once payment succeeds
   */
  async openConversation(bookingId) {
    const stringId = String(bookingId);
    const update = {
      isOpen: true,
      openedAt: new Date().toISOString(),
    };

    if (firestore) {
      await firestore.collection('conversations').doc(stringId).set(update, { merge: true });
    } else if (mockConversations.has(stringId)) {
      const current = mockConversations.get(stringId);
      mockConversations.set(stringId, { ...current, ...update });
    }
    logger.info(`Chat conversation ${stringId} is now OPEN`);
  }

  /**
   * Lock a conversation (read-only) once booking is completed or cancelled
   */
  async lockConversation(bookingId) {
    const stringId = String(bookingId);
    const update = {
      isLocked: true,
      lockedAt: new Date().toISOString(),
    };

    if (firestore) {
      await firestore.collection('conversations').doc(stringId).set(update, { merge: true });
    } else if (mockConversations.has(stringId)) {
      const current = mockConversations.get(stringId);
      mockConversations.set(stringId, { ...current, ...update });
    }
    logger.info(`Chat conversation ${stringId} is now LOCKED`);
  }

  /**
   * Fetch conversation metadata by ID
   */
  async getConversation(conversationId) {
    const stringId = String(conversationId);

    if (firestore) {
      const doc = await firestore.collection('conversations').doc(stringId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }

    return mockConversations.get(stringId) || null;
  }

  /**
   * Generate a custom Firebase Auth token with role claim
   */
  async generateChatToken(userId, role) {
    const stringUserId = String(userId);
    const claims = { role: role || ROLES.CLIENT };

    if (auth) {
      const customToken = await auth.createCustomToken(stringUserId, claims);
      return customToken;
    }

    // Mock token for local/test mode
    return `mock_firebase_token_for_${stringUserId}_role_${claims.role}`;
  }

  /**
   * Get paginated message history from a conversation
   */
  async getMessages(conversationId, userId, userRole, { limit = 50, startAfter } = {}) {
    const stringConvId = String(conversationId);
    const stringUserId = String(userId);
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));

    const conversation = await this.getConversation(stringConvId);
    if (!conversation) {
      throw new ApiError(404, 'Conversation not found');
    }

    // Access control: User must be a participant OR an admin reviewing an active dispute
    const isParticipant = conversation.participants?.includes(stringUserId);
    const isAdmin = userRole === ROLES.ADMIN;

    if (!isParticipant && !isAdmin) {
      throw new ApiError(403, 'You do not have access to this conversation');
    }

    if (isAdmin && !isParticipant) {
      const booking = await bookingRepository.findById(conversation.bookingId);
      if (!booking || (booking.status !== 'disputed' && booking.status !== 'cancelled')) {
        throw new ApiError(403, 'Admin chat access is restricted to disputed or investigated bookings');
      }
      eventBus.emit(EVENTS.ADMIN_CHAT_ACCESSED, {
        adminId: stringUserId,
        bookingId: conversation.bookingId,
        conversationId: stringConvId,
      });
    }

    if (firestore) {
      let query = firestore
        .collection('conversations')
        .doc(stringConvId)
        .collection('messages')
        .orderBy('createdAt', 'asc')
        .limit(parsedLimit);

      if (startAfter) {
        const startDoc = await firestore
          .collection('conversations')
          .doc(stringConvId)
          .collection('messages')
          .doc(startAfter)
          .get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      const snapshot = await query.get();
      const messages = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      const lastDoc = snapshot.docs[snapshot.docs.length - 1];

      return {
        conversation,
        items: messages,
        nextCursor: lastDoc ? lastDoc.id : null,
      };
    }

    // In-memory fallback
    const allMessages = mockMessages.get(stringConvId) || [];
    let startIndex = 0;
    if (startAfter) {
      const idx = allMessages.findIndex((m) => m.id === startAfter);
      if (idx !== -1) startIndex = idx + 1;
    }

    const slice = allMessages.slice(startIndex, startIndex + parsedLimit);
    const lastItem = slice[slice.length - 1];

    return {
      conversation,
      items: slice,
      nextCursor: lastItem && startIndex + parsedLimit < allMessages.length ? lastItem.id : null,
    };
  }

  /**
   * Send a message through the REST fallback / image upload handler
   */
  async sendMessage(conversationId, senderId, { content, type = 'text' }) {
    const stringConvId = String(conversationId);
    const stringSenderId = String(senderId);

    const conversation = await this.getConversation(stringConvId);
    if (!conversation) {
      throw new ApiError(404, 'Conversation not found');
    }

    if (!conversation.participants?.includes(stringSenderId)) {
      throw new ApiError(403, 'You are not a participant in this conversation');
    }

    if (!conversation.isOpen) {
      throw new ApiError(400, 'Chat is not open yet. It will unlock automatically once payment succeeds.');
    }

    if (conversation.isLocked) {
      throw new ApiError(400, 'Chat is locked because this booking has ended.');
    }

    // Real-time Content Moderation Scan
    if (type === 'text' && content) {
      const recipientId = conversation.participants?.find((p) => p !== stringSenderId);
      await moderationService.scanAndEnforce(stringSenderId, 'MESSAGE', content, {
        conversationId: stringConvId,
        recipientId,
      });
    }

    const messageData = {
      senderId: stringSenderId,
      type: type || 'text',
      content: content.trim(),
      deliveredAt: null,
      seenAt: null,
      createdAt: new Date().toISOString(),
    };

    let messageId;

    if (firestore) {
      const msgRef = await firestore
        .collection('conversations')
        .doc(stringConvId)
        .collection('messages')
        .add(messageData);

      messageId = msgRef.id;

      await firestore
        .collection('conversations')
        .doc(stringConvId)
        .set({ lastMessageAt: messageData.createdAt }, { merge: true });
    } else {
      messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const list = mockMessages.get(stringConvId) || [];
      list.push({ id: messageId, ...messageData });
      mockMessages.set(stringConvId, list);

      mockConversations.set(stringConvId, {
        ...conversation,
        lastMessageAt: messageData.createdAt,
      });
    }

    const createdMessage = { id: messageId, ...messageData };

    // Emit event for push notification dispatch to other participants
    eventBus.emit(EVENTS.CHAT_MESSAGE_SENT, {
      conversationId: stringConvId,
      bookingId: conversation.bookingId,
      senderId: stringSenderId,
      participants: conversation.participants,
      message: createdMessage,
    });

    return createdMessage;
  }
}

export const chatService = new ChatService();
export default chatService;
