import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import AiConversation from '../../src/modules/ai/conversation/ai-conversation.model.js';
import AiMessage from '../../src/modules/ai/conversation/ai-message.model.js';
import * as conversationService from '../../src/modules/ai/conversation/ai-conversation.service.js';

describe('AiConversation & AiMessage Models & Service (Unit)', () => {
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDB();
    await AiConversation.init();
    await AiMessage.init();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await AiConversation.init();
    await AiMessage.init();
  });

  describe('AiConversation Schema & Indexes', () => {
    it('requires userId', async () => {
      const conv = new AiConversation({});
      let err;
      try {
        await conv.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.userId).toBeDefined();
    });

    it('has compound index on { userId: 1, lastMessageAt: -1 }', () => {
      const indexes = AiConversation.schema.indexes();
      const hasIndex = indexes.some(([fields]) => {
        return fields.userId === 1 && fields.lastMessageAt === -1;
      });
      expect(hasIndex).toBe(true);
    });

    it('defaults title to New Conversation and lastMessageAt to current timestamp', async () => {
      const conv = await AiConversation.create({ userId });
      expect(conv.title).toBe('New Conversation');
      expect(conv.lastMessageAt).toBeDefined();
    });
  });

  describe('AiMessage Schema & Indexes', () => {
    it('requires conversationId, role, and content', async () => {
      const msg = new AiMessage({});
      let err;
      try {
        await msg.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.conversationId).toBeDefined();
      expect(err.errors.role).toBeDefined();
      expect(err.errors.content).toBeDefined();
    });

    it('rejects invalid role enum', async () => {
      const msg = new AiMessage({
        conversationId: new mongoose.Types.ObjectId(),
        role: 'system_admin',
        content: 'hello',
      });
      let err;
      try {
        await msg.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.role).toBeDefined();
    });

    it('has compound index on { conversationId: 1, createdAt: 1 }', () => {
      const indexes = AiMessage.schema.indexes();
      const hasIndex = indexes.some(([fields]) => {
        return fields.conversationId === 1 && fields.createdAt === 1;
      });
      expect(hasIndex).toBe(true);
    });
  });

  describe('Conversation & Message Service Operations', () => {
    it('creates conversation and appends chronological messages updating lastMessageAt', async () => {
      const conv = await conversationService.createConversation(userId, 'Wedding Stylist');
      expect(conv._id).toBeDefined();
      expect(conv.title).toBe('Wedding Stylist');

      const initialLastMessageAt = conv.lastMessageAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const userMsg = await conversationService.addMessage(conv._id, userId, {
        role: 'user',
        content: 'I need an outfit for a summer formal wedding.',
        traceId: 'trace-123',
      });

      expect(userMsg._id).toBeDefined();
      expect(userMsg.role).toBe('user');
      expect(userMsg.traceId).toBe('trace-123');

      const assistantMsg = await conversationService.addMessage(conv._id, userId, {
        role: 'assistant',
        content: 'Here is an elegant tailored suit outfit.',
        structuredResult: { outfitScore: 95 },
        traceId: 'trace-124',
      });

      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.structuredResult).toEqual({ outfitScore: 95 });

      // Verify conversation lastMessageAt was updated
      const updatedConv = await conversationService.getConversation(conv._id, userId);
      expect(new Date(updatedConv.lastMessageAt).getTime()).toBeGreaterThanOrEqual(
        new Date(initialLastMessageAt).getTime()
      );

      // Verify messages are fetched chronologically
      const messagesResult = await conversationService.getConversationMessages(conv._id, userId);
      expect(messagesResult.total).toBe(2);
      expect(messagesResult.items[0].content).toContain('summer formal wedding');
      expect(messagesResult.items[1].content).toContain('elegant tailored suit');
    });

    it('enforces user ownership isolation: other user cannot access or add messages', async () => {
      const conv = await conversationService.createConversation(userId, 'Private Conversation');

      // Other user cannot view conversation
      const checkOther = await conversationService.getConversation(conv._id, otherUserId);
      expect(checkOther).toBeNull();

      // Other user cannot add messages
      await expect(
        conversationService.addMessage(conv._id, otherUserId, {
          role: 'user',
          content: 'Sneaky message',
        })
      ).rejects.toThrow('Conversation not found or access denied');

      // Other user cannot retrieve messages
      await expect(
        conversationService.getConversationMessages(conv._id, otherUserId)
      ).rejects.toThrow('Conversation not found or access denied');
    });

    it('deleteConversation deletes conversation and cascades deletion of its messages', async () => {
      const conv = await conversationService.createConversation(userId, 'To be deleted');
      await conversationService.addMessage(conv._id, userId, { role: 'user', content: 'Msg 1' });
      await conversationService.addMessage(conv._id, userId, { role: 'assistant', content: 'Msg 2' });

      expect(await AiMessage.countDocuments({ conversationId: conv._id })).toBe(2);

      await conversationService.deleteConversation(conv._id, userId);

      expect(await AiConversation.findById(conv._id)).toBeNull();
      expect(await AiMessage.countDocuments({ conversationId: conv._id })).toBe(0);
    });
  });
});
