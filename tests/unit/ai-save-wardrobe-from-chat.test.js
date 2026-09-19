/**
 * Phase 15C Step 8 — Save to Wardrobe from Chat Tests (wardrobe.service.js).
 *
 * Covers:
 * 1. Happy path: Promotes asset, creates WardrobeItem with origin: 'chat_save',
 *    normalizes attributes without extra LLM calls, updates vector DB, and clears imageExpiresAt.
 * 2. Idempotency: Repeated saves return the already saved item without duplication.
 * 3. Capacity guard: Plan limit enforcement throws 429 when storage is full.
 * 4. Ownership & error handling: 404 on unowned message, 400 on message without image.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import wardrobeRepo from '../../src/modules/wardrobe/wardrobe.repository.js';
import aiConversationService from '../../src/modules/ai/conversation/ai-conversation.service.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import vectorConfig from '../../src/config/vector.config.js';
import cloudinary from '../../src/config/cloudinary.config.js';

describe('Phase 15C Step 8 — saveWardrobeItemFromChat', () => {
  const mockUserId = 'user_save_chat_123';
  const mockMessageId = 'msg_garment_456';
  const mockImageRef = `murafiq/ai-chat/${mockUserId}/shirt-uuid`;

  let updateMessageSpy;
  let capacitySpy;
  let createItemSpy;
  let findItemSpy;
  let renameSpy;
  let vectorUpsertSpy;

  beforeEach(() => {
    capacitySpy = jest.spyOn(entitlementService, 'capacity').mockResolvedValue({
      hasCapacity: true,
      limit: 100,
    });

    renameSpy = jest.spyOn(cloudinary.uploader, 'rename').mockResolvedValue({
      public_id: `murafiq/wardrobe/${mockUserId}/shirt-uuid`,
    });

    vectorUpsertSpy = jest.fn().mockResolvedValue(true);
    jest.spyOn(vectorConfig, 'getUserVectorNamespace').mockReturnValue({
      upsert: vectorUpsertSpy,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('saves garment image from chat, promotes asset, and marks message as saved', async () => {
    jest.spyOn(aiConversationService, 'getMessageById').mockResolvedValueOnce({
      _id: mockMessageId,
      imageRef: mockImageRef,
      imageUrl: 'https://cloudinary.com/ai-chat/shirt.jpg',
      imageAnalysis: {
        category: 'top',
        subcategory: 'oxford_shirt',
        colors: ['blue'],
        colorFamily: 'blue',
        pattern: 'solid',
        formality: 'smart_casual',
        material: 'cotton',
        confidence: 0.95,
      },
      savedWardrobeItemId: null,
    });

    const mockSavedItem = {
      _id: 'wardrobe_item_789',
      userId: mockUserId,
      imageUrl: 'https://cloudinary.com/wardrobe/shirt.jpg',
      origin: 'chat_save',
      category: 'top',
      subcategory: 'oxford_shirt',
      colorFamily: 'blue',
      aiDescription: 'blue cotton top',
    };

    createItemSpy = jest.spyOn(wardrobeRepo, 'createWardrobeItem').mockResolvedValueOnce(mockSavedItem);
    updateMessageSpy = jest.spyOn(aiConversationService, 'updateMessage').mockResolvedValueOnce(true);

    const result = await wardrobeService.saveWardrobeItemFromChat(mockUserId, mockMessageId);

    // 1. Entitlement check
    expect(capacitySpy).toHaveBeenCalledWith(mockUserId, 'wardrobe.photos.max', 'client');

    // 2. Cloudinary asset rename
    expect(renameSpy).toHaveBeenCalledWith(
      mockImageRef,
      `murafiq/wardrobe/${mockUserId}/shirt-uuid`,
      { overwrite: true }
    );

    // 3. Wardrobe item creation with origin: 'chat_save' and status: 'done'
    expect(createItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mockUserId,
        origin: 'chat_save',
        classificationStatus: 'done',
        category: 'top',
        colorFamily: 'blue',
      })
    );

    // 4. Vector DB indexing
    expect(vectorUpsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'wardrobe_item_789',
        metadata: expect.objectContaining({ category: 'top' }),
      })
    );

    // 5. AiMessage update: cleared imageExpiresAt and recorded savedWardrobeItemId
    expect(updateMessageSpy).toHaveBeenCalledWith(
      mockMessageId,
      expect.objectContaining({
        savedWardrobeItemId: 'wardrobe_item_789',
        imageExpiresAt: null,
      })
    );

    expect(result._id).toBe('wardrobe_item_789');
    expect(result.origin).toBe('chat_save');
  });

  it('is idempotent: returns existing item when message was already saved', async () => {
    const existingItemId = 'already_saved_item_111';
    jest.spyOn(aiConversationService, 'getMessageById').mockResolvedValueOnce({
      _id: mockMessageId,
      imageRef: mockImageRef,
      savedWardrobeItemId: existingItemId,
    });

    const existingItem = {
      _id: existingItemId,
      userId: mockUserId,
      name: 'Existing Saved Shirt',
    };

    findItemSpy = jest.spyOn(wardrobeRepo, 'findWardrobeItemByIdAndUser').mockResolvedValueOnce(existingItem);
    createItemSpy = jest.spyOn(wardrobeRepo, 'createWardrobeItem');

    const result = await wardrobeService.saveWardrobeItemFromChat(mockUserId, mockMessageId);

    expect(result).toEqual(existingItem);
    expect(findItemSpy).toHaveBeenCalledWith(existingItemId, mockUserId);
    expect(createItemSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it('enforces wardrobe capacity: rejects with 429 when quota is reached', async () => {
    jest.spyOn(aiConversationService, 'getMessageById').mockResolvedValueOnce({
      _id: mockMessageId,
      imageRef: mockImageRef,
      imageAnalysis: { category: 'top' },
      savedWardrobeItemId: null,
    });

    capacitySpy.mockResolvedValueOnce({
      hasCapacity: false,
      limit: 5,
    });

    createItemSpy = jest.spyOn(wardrobeRepo, 'createWardrobeItem');

    await expect(
      wardrobeService.saveWardrobeItemFromChat(mockUserId, mockMessageId)
    ).rejects.toThrow(/Wardrobe photo limit reached/i);

    expect(createItemSpy).not.toHaveBeenCalled();
  });

  it('throws 404 when message does not exist or user does not own conversation', async () => {
    jest.spyOn(aiConversationService, 'getMessageById').mockResolvedValueOnce(null);

    await expect(
      wardrobeService.saveWardrobeItemFromChat(mockUserId, 'unowned_msg')
    ).rejects.toThrow(/Message not found or access denied/i);
  });

  it('throws 400 when message has no analyzed garment image', async () => {
    jest.spyOn(aiConversationService, 'getMessageById').mockResolvedValueOnce({
      _id: mockMessageId,
      imageRef: null,
      imageAnalysis: null,
      savedWardrobeItemId: null,
    });

    await expect(
      wardrobeService.saveWardrobeItemFromChat(mockUserId, mockMessageId)
    ).rejects.toThrow(/does not contain an analyzed garment image/i);
  });
});
