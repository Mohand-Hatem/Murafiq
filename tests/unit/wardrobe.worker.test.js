import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import wardrobeWorkerModule from '../../src/jobs/workers/wardrobe-classification.worker.js';
import geminiService from '../../src/config/gemini.config.js';
import vectorConfig from '../../src/config/vector.config.js';
import wardrobeRepo from '../../src/modules/wardrobe/wardrobe.repository.js';
import { CLASSIFICATION_STATUS } from '../../src/modules/wardrobe/wardrobe-item.model.js';

describe('Wardrobe Classification Worker Unit Tests', () => {
  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockItemId = new mongoose.Types.ObjectId().toString();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should classify clothing image and update status to done', async () => {
    const job = {
      data: {
        itemId: mockItemId,
        userId: mockUserId,
        imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/sneakers.jpg',
      },
    };

    const mockClassified = {
      category: 'shoes',
      primaryColor: 'White',
      secondaryColors: ['Green'],
      pattern: 'solid',
      formality: 'casual',
      season: ['all_season'],
      material: 'leather',
      styleTags: ['streetwear', 'classic'],
      aiDescription: 'Classic white leather tennis sneakers with subtle green heel accents.',
    };

    jest.spyOn(geminiService, 'classifyClothingImage').mockResolvedValue(mockClassified);
    const mockUpsert = jest.fn().mockResolvedValue({ success: true });
    jest.spyOn(vectorConfig, 'getUserVectorNamespace').mockReturnValue({
      upsert: mockUpsert,
      delete: jest.fn(),
    });
    const updateSpy = jest.spyOn(wardrobeRepo, 'updateWardrobeItemById').mockResolvedValue({
      _id: mockItemId,
      classificationStatus: CLASSIFICATION_STATUS.DONE,
    });

    const result = await wardrobeWorkerModule.processWardrobeJob(job);

    expect(geminiService.classifyClothingImage).toHaveBeenCalledWith(job.data.imageUrl);
    expect(mockUpsert).toHaveBeenCalledWith({
      id: mockItemId,
      data: mockClassified.aiDescription,
      metadata: {
        category: 'shoes',
        formality: 'casual',
        season: ['all_season'],
        material: 'leather',
        primaryColor: 'White',
      },
    });
    expect(updateSpy).toHaveBeenCalledWith(mockItemId, expect.objectContaining({
      category: 'shoes',
      classificationStatus: CLASSIFICATION_STATUS.DONE,
      embeddingId: mockItemId,
    }));
    expect(result.classificationStatus).toBe(CLASSIFICATION_STATUS.DONE);
  });

  it('should mark item status as failed when classification throws error', async () => {
    const job = {
      data: {
        itemId: mockItemId,
        userId: mockUserId,
        imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/bad.jpg',
      },
    };

    jest.spyOn(geminiService, 'classifyClothingImage').mockRejectedValue(new Error('Gemini API timeout'));
    const updateSpy = jest.spyOn(wardrobeRepo, 'updateWardrobeItemById').mockResolvedValue({});

    await expect(wardrobeWorkerModule.processWardrobeJob(job)).rejects.toThrow('Gemini API timeout');

    expect(updateSpy).toHaveBeenCalledWith(mockItemId, {
      classificationStatus: CLASSIFICATION_STATUS.FAILED,
      classificationError: 'Gemini API timeout',
    });
  });
});
