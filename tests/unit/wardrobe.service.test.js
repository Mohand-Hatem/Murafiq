import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import wardrobeRepo from '../../src/modules/wardrobe/wardrobe.repository.js';
import queueModule from '../../src/jobs/queues/wardrobe.queue.js';
import vectorConfig from '../../src/config/vector.config.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import { CLASSIFICATION_STATUS } from '../../src/modules/wardrobe/wardrobe-item.model.js';

describe('Wardrobe Service Unit Tests', () => {
  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockItemId = new mongoose.Types.ObjectId().toString();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createWardrobeItem', () => {
    it('should create a pending item and enqueue classification job with valid uploadRef', async () => {
      const validUploadRef = `murafiq/wardrobe/${mockUserId}/item-uuid-123`;
      const expectedCloudinaryUrl = `https://res.cloudinary.com/murafiq/image/upload/v1/${validUploadRef}`;
      const mockCreatedItem = {
        _id: mockItemId,
        userId: mockUserId,
        imageUrl: expectedCloudinaryUrl,
        sourceUploadRef: validUploadRef,
        classificationStatus: CLASSIFICATION_STATUS.PENDING,
      };

      jest
        .spyOn(entitlementService, 'capacity')
        .mockResolvedValue({ limit: 25, used: 0, available: 25, hasCapacity: true });
      jest.spyOn(wardrobeRepo, 'createWardrobeItem').mockResolvedValue(mockCreatedItem);
      const queueSpy = jest.spyOn(queueModule, 'addWardrobeClassificationJob').mockResolvedValue({ id: 'job-1' });

      const result = await wardrobeService.createWardrobeItem(mockUserId, {
        uploadRef: validUploadRef,
      });

      expect(entitlementService.capacity).toHaveBeenCalledWith(mockUserId, 'wardrobe.photos.max', 'client');
      expect(wardrobeRepo.createWardrobeItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          sourceUploadRef: validUploadRef,
          classificationStatus: CLASSIFICATION_STATUS.PENDING,
        })
      );
      expect(queueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: mockItemId,
          userId: mockUserId,
        })
      );
      expect(result).toEqual(mockCreatedItem);
    });

    it('rejects with 400 when uploadRef belongs to another user', async () => {
      const foreignUserId = new mongoose.Types.ObjectId().toString();
      const foreignUploadRef = `murafiq/wardrobe/${foreignUserId}/item-uuid-456`;

      const createSpy = jest.spyOn(wardrobeRepo, 'createWardrobeItem');
      const queueSpy = jest.spyOn(queueModule, 'addWardrobeClassificationJob');

      await expect(
        wardrobeService.createWardrobeItem(mockUserId, { uploadRef: foreignUploadRef })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'uploadRef does not belong to the authenticated user',
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(queueSpy).not.toHaveBeenCalled();
    });

    it('rejects with 429 when the wardrobe.photos.max cap is reached, before creating anything', async () => {
      const validUploadRef = `murafiq/wardrobe/${mockUserId}/item-uuid-123`;
      jest
        .spyOn(entitlementService, 'capacity')
        .mockResolvedValue({ limit: 7, used: 7, available: 0, hasCapacity: false });
      const createSpy = jest.spyOn(wardrobeRepo, 'createWardrobeItem');
      const queueSpy = jest.spyOn(queueModule, 'addWardrobeClassificationJob');

      await expect(
        wardrobeService.createWardrobeItem(mockUserId, { uploadRef: validUploadRef })
      ).rejects.toMatchObject({ statusCode: 429 });

      expect(createSpy).not.toHaveBeenCalled();
      expect(queueSpy).not.toHaveBeenCalled();
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

  describe('getWardrobeCategorySummary', () => {
    it('should return all 6 default categories in order plus others fallback', async () => {
      const mockAggregated = [
        {
          category: 'top',
          count: 5,
          previewImages: ['https://example.com/top1.jpg', 'https://example.com/top2.jpg'],
        },
        {
          category: 'shoes',
          count: 3,
          previewImages: ['https://example.com/shoe1.jpg'],
        },
        {
          category: 'others',
          count: 2,
          previewImages: ['https://example.com/other1.jpg'],
        },
      ];

      jest
        .spyOn(wardrobeRepo, 'getCategorySummaryAggregation')
        .mockResolvedValue(mockAggregated);

      const result = await wardrobeService.getWardrobeCategorySummary(mockUserId);

      expect(wardrobeRepo.getCategorySummaryAggregation).toHaveBeenCalledWith(mockUserId);
      expect(result.categories).toHaveLength(6);

      // Verify 6 core categories in ordered order
      const categoryIds = result.categories.map((c) => c.id);
      expect(categoryIds).toEqual(['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']);

      // Top has count 5
      const topCat = result.categories.find((c) => c.id === 'top');
      expect(topCat.itemCount).toBe(5);
      expect(topCat.previewImages).toEqual(['https://example.com/top1.jpg', 'https://example.com/top2.jpg']);
      expect(topCat.name).toBe('Top Clothes');
      expect(topCat.nameAr).toBe('ملابس علوية');

      // Shoes has count 3
      const shoesCat = result.categories.find((c) => c.id === 'shoes');
      expect(shoesCat.itemCount).toBe(3);

      // Empty categories have count 0 and empty previews
      const bottomCat = result.categories.find((c) => c.id === 'bottom');
      expect(bottomCat.itemCount).toBe(0);
      expect(bottomCat.previewImages).toEqual([]);

      // Others fallback
      expect(result.others.id).toBe('others');
      expect(result.others.itemCount).toBe(2);
      expect(result.others.previewImages).toEqual(['https://example.com/other1.jpg']);
      expect(result.others.name).toBe('Others');
      expect(result.others.nameAr).toBe('أخرى');

      // Totals
      expect(result.totalItems).toBe(10);
      expect(result.unclassifiedCount).toBe(2);
    });

    it('should return all categories with 0 count when wardrobe is empty', async () => {
      jest.spyOn(wardrobeRepo, 'getCategorySummaryAggregation').mockResolvedValue([]);

      const result = await wardrobeService.getWardrobeCategorySummary(mockUserId);

      expect(result.categories).toHaveLength(6);
      result.categories.forEach((cat) => {
        expect(cat.itemCount).toBe(0);
        expect(cat.previewImages).toEqual([]);
      });
      expect(result.others.itemCount).toBe(0);
      expect(result.totalItems).toBe(0);
      expect(result.unclassifiedCount).toBe(0);
    });
  });
});
