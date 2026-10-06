import '../../../../src/common/globals.js';
import { jest } from '@jest/globals';
import AiConversation from '../../../../src/modules/ai/conversation/ai-conversation.model.js';
import * as conversationService from '../../../../src/modules/ai/conversation/ai-conversation.service.js';
import * as outfitService from '../../../../src/modules/ai/outfits/outfit.service.js';

describe('AI Services ApiError Handling (TD-01)', () => {
  describe('ai-conversation.service', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('addMessage should throw ApiError(404) when conversation not found', async () => {
      jest.spyOn(AiConversation, 'findById').mockResolvedValue(null);

      await expect(
        conversationService.addMessage('missing-id', 'user-1', { content: 'hello' })
      ).rejects.toThrow(ApiError);

      try {
        await conversationService.addMessage('missing-id', 'user-1', { content: 'hello' });
      } catch (err) {
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe('Conversation not found or access denied');
      }
    });

    it('getConversationMessages should throw ApiError(404) when conversation not found', async () => {
      jest.spyOn(AiConversation, 'findById').mockResolvedValue(null);

      await expect(
        conversationService.getConversationMessages('missing-id', 'user-1')
      ).rejects.toThrow(ApiError);

      try {
        await conversationService.getConversationMessages('missing-id', 'user-1');
      } catch (err) {
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe('Conversation not found or access denied');
      }
    });
  });

  describe('outfit.service', () => {
    it('setUserFeedback should throw ApiError(400) when feedback is invalid', async () => {
      await expect(
        outfitService.setUserFeedback('outfit-1', 'user-1', 'invalid_feedback')
      ).rejects.toThrow(ApiError);

      try {
        await outfitService.setUserFeedback('outfit-1', 'user-1', 'invalid_feedback');
      } catch (err) {
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('Invalid feedback value: invalid_feedback');
      }
    });
  });
});
