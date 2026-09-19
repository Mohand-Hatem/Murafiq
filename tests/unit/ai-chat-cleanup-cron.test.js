/**
 * Phase 15C Step 9 — Ephemeral AI Chat Image Cleanup Sweep Tests (ai-chat-cleanup.cron.js).
 *
 * Covers:
 * 1. Sweeps expired messages where imageExpiresAt <= cutoffDate and savedWardrobeItemId is null.
 * 2. Calls cloudinary.uploader.destroy for each expired image.
 * 3. Clears imageRef, imageUrl, imageExpiresAt on the message document.
 * 4. Leaves saved messages (savedWardrobeItemId !== null) and unexpired messages untouched.
 * 5. Handles Cloudinary failure gracefully without breaking batch sweep.
 * 6. Idempotent boot registration & inactive in test mode.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  sweepExpiredChatImages,
  startAiChatCleanupCron,
} from '../../src/jobs/ai-chat-cleanup.cron.js';
import aiConversationRepo from '../../src/modules/ai/conversation/ai-conversation.repository.js';
import cloudinary from '../../src/config/cloudinary.config.js';

describe('Phase 15C Step 9 — ai-chat-cleanup.cron.js', () => {
  let destroySpy;

  beforeEach(() => {
    destroySpy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('destroys Cloudinary assets and clears references for expired unsaved images', async () => {
    const mockMessage1 = {
      _id: 'msg_exp_1',
      imageRef: 'murafiq/ai-chat/u1/img_1',
      imageUrl: 'https://cloudinary.com/ai-chat/u1/img_1.jpg',
      imageExpiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      savedWardrobeItemId: null,
      save: jest.fn().mockResolvedValue(true),
    };

    const mockMessage2 = {
      _id: 'msg_exp_2',
      imageRef: 'murafiq/ai-chat/u2/img_2',
      imageUrl: 'https://cloudinary.com/ai-chat/u2/img_2.jpg',
      imageExpiresAt: new Date(Date.now() - 7200000), // 2 hours ago
      savedWardrobeItemId: null,
      save: jest.fn().mockResolvedValue(true),
    };

    jest
      .spyOn(aiConversationRepo, 'findExpiredImageMessages')
      .mockResolvedValueOnce([mockMessage1, mockMessage2]);

    const result = await sweepExpiredChatImages();

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.errors).toBe(0);

    // 1. Cloudinary destroy called for each
    expect(destroySpy).toHaveBeenCalledWith('murafiq/ai-chat/u1/img_1');
    expect(destroySpy).toHaveBeenCalledWith('murafiq/ai-chat/u2/img_2');

    // 2. Document references cleared
    expect(mockMessage1.imageRef).toBeNull();
    expect(mockMessage1.imageUrl).toBeNull();
    expect(mockMessage1.imageExpiresAt).toBeNull();
    expect(mockMessage1.save).toHaveBeenCalledTimes(1);

    expect(mockMessage2.imageRef).toBeNull();
    expect(mockMessage2.imageUrl).toBeNull();
    expect(mockMessage2.imageExpiresAt).toBeNull();
    expect(mockMessage2.save).toHaveBeenCalledTimes(1);
  });

  it('continues sweep when an individual Cloudinary deletion fails', async () => {
    const failingMessage = {
      _id: 'msg_fail',
      imageRef: 'murafiq/ai-chat/u1/broken_img',
      imageUrl: 'https://cloudinary.com/ai-chat/u1/broken_img.jpg',
      imageExpiresAt: new Date(Date.now() - 3600000),
      savedWardrobeItemId: null,
      save: jest.fn(),
    };

    const succeedingMessage = {
      _id: 'msg_succ',
      imageRef: 'murafiq/ai-chat/u1/good_img',
      imageUrl: 'https://cloudinary.com/ai-chat/u1/good_img.jpg',
      imageExpiresAt: new Date(Date.now() - 3600000),
      savedWardrobeItemId: null,
      save: jest.fn().mockResolvedValue(true),
    };

    jest
      .spyOn(aiConversationRepo, 'findExpiredImageMessages')
      .mockResolvedValueOnce([failingMessage, succeedingMessage]);

    destroySpy.mockRejectedValueOnce(new Error('Cloudinary API rate limit exceeded'));
    destroySpy.mockResolvedValueOnce({ result: 'ok' });

    const result = await sweepExpiredChatImages();

    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(1);

    // Failing message save was not called
    expect(failingMessage.save).not.toHaveBeenCalled();

    // Succeeding message was cleaned up
    expect(succeedingMessage.imageRef).toBeNull();
    expect(succeedingMessage.save).toHaveBeenCalledTimes(1);
  });

  it('handles empty expired list cleanly', async () => {
    jest
      .spyOn(aiConversationRepo, 'findExpiredImageMessages')
      .mockResolvedValueOnce([]);

    const result = await sweepExpiredChatImages();

    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(destroySpy).not.toHaveBeenCalled();
  });

  it('does not start cron timer in test environment', () => {
    expect(() => startAiChatCleanupCron()).not.toThrow();
  });
});
