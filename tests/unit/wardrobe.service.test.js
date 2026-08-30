import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import wardrobeRepo from '../../src/modules/wardrobe/wardrobe.repository.js';
import queueModule from '../../src/jobs/queues/wardrobe.queue.js';
import vectorConfig from '../../src/config/vector.config.js';
import { CLASSIFICATION_STATUS } from '../../src/modules/wardrobe/wardrobe-item.model.js';

describe('Wardrobe Service Unit Tests', () => {
  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockItemId = new mongoose.Types.ObjectId().toString();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createWardrobeItem', () => {
    it('should create a pending item and enqueue classification job', async () => {
      const mockCreatedItem = {
        _id: mockItemId,
        userId: mockUserId,
        imageUrl: 'https://example.com/item.jpg',
        classificationStatus: CLASSIFICATION_STATUS.PENDING,
      };

      jest.spyOn(wardrobeRepo, 'createWardrobeItem').mockResolvedValue(mockCreatedItem);
      const queueSpy = jest.spyOn(queueModule, 'addWardrobeClassificationJob').mockResolvedValue({ id: 'job-1' });

      const result = await wardrobeService.createWardrobeItem(mockUserId, {
        imageUrl: 'https://example.com/item.jpg',
      });

      expect(wardrobeRepo.createWardrobeItem).toHaveBeenCalledWith({
        userId: mockUserId,
        imageUrl: 'https://example.com/item.jpg',
        classificationStatus: CLASSIFICATION_STATUS.PENDING,
      });
      expect(queueSpy).toHaveBeenCalledWith({
        itemId: mockItemId,
        userId: mockUserId,
        imageUrl: 'https://example.com/item.jpg',
      });
      expect(result).toEqual(mockCreatedItem);
    });
  });

  describe('getWardrobeItemById', () => {
    it('should return item when owned by user', async () => {
      const mockItem = { _id: mockItemId, userId: mockUserId, category: 'top' };
      jest.spyOn(wardrobeRepo, 'findWardrobeItemByIdAndUser').mockResolvedValue(mockItem);

      const result = await wardrobeService.getWardrobeItemById(mockUserId, mockItemId);
      expect(result).toEqual(mockItem);
    });

    it('should throw 404 when item does not exist or user mismatch', async () => {
      jest.spyOn(wardrobeRepo, 'findWardrobeItemByIdAndUser').mockResolvedValue(null);

      await expect(wardrobeService.getWardrobeItemById(mockUserId, mockItemId)).rejects.toThrow(
        'Wardrobe item not found or you do not have permission'
      );
    });
  });

  describe('updateWardrobeItem', () => {
    it('should update item attributes and sync vector index', async () => {
      const existing = { _id: mockItemId, userId: mockUserId, category: 'top', aiDescription: 'Old description' };
      const updated = { ...existing, primaryColor: 'Red', aiDescription: 'Updated red top' };

      jest.spyOn(wardrobeRepo, 'findWardrobeItemByIdAndUser').mockResolvedValue(existing);
      jest.spyOn(wardrobeRepo, 'updateWardrobeItemById').mockResolvedValue(updated);

      const mockUpsert = jest.fn().mockResolvedValue({ success: true });
      jest.spyOn(vectorConfig, 'getUserVectorNamespace').mockReturnValue({
        upsert: mockUpsert,
        delete: jest.fn(),
      });

      const result = await wardrobeService.updateWardrobeItem(mockUserId, mockItemId, {
        primaryColor: 'Red',
        aiDescription: 'Updated red top',
      });

      expect(wardrobeRepo.updateWardrobeItemById).toHaveBeenCalledWith(mockItemId, {
        primaryColor: 'Red',
        aiDescription: 'Updated red top',
      });
      expect(mockUpsert).toHaveBeenCalledWith({
        id: mockItemId,
        data: 'Updated red top',
        metadata: expect.any(Object),
      });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteWardrobeItem', () => {
    it('should delete from database and vector namespace', async () => {
      const existing = { _id: mockItemId, userId: mockUserId };
      jest.spyOn(wardrobeRepo, 'deleteWardrobeItemByIdAndUser').mockResolvedValue(existing);

      const mockDelete = jest.fn().mockResolvedValue({ success: true });
      jest.spyOn(vectorConfig, 'getUserVectorNamespace').mockReturnValue({
        upsert: jest.fn(),
        delete: mockDelete,
      });

      const result = await wardrobeService.deleteWardrobeItem(mockUserId, mockItemId);

      expect(wardrobeRepo.deleteWardrobeItemByIdAndUser).toHaveBeenCalledWith(mockItemId, mockUserId);
      expect(mockDelete).toHaveBeenCalledWith(mockItemId);
      expect(result).toEqual({ success: true });
    });
  });
});
