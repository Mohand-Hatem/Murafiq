import shapeModelRepository from './shape-model.repository.js';
import { toShapeModelDto } from './shape-model.dto.js';
import uploadService from '../../uploads/upload.service.js';
import { logger } from '../../../config/logger.config.js';

/**
 * Creates a new active ShapeModel, replacing any existing active model
 * and destroying the replaced Cloudinary asset.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {Object} params
 * @param {string} params.imageRef
 * @param {boolean} params.consent
 * @param {string} [params.format='jpg']
 * @param {number} [params.bytes=0]
 * @param {number} [params.width=0]
 * @param {number} [params.height=0]
 * @returns {Promise<Object>} Mapped ShapeModel DTO
 */
export const createOrReplace = async (
  userId,
  { imageRef, consent, format = 'jpg', bytes = 0, width = 0, height = 0 }
) => {
  const userStr = userId.toString();
  const expectedPrefix = `murafiq/shape-models/${userStr}/`;

  if (!imageRef || !imageRef.startsWith(expectedPrefix)) {
    throw new ApiError(
      400,
      'Invalid imageRef: must belong to the authenticated user and shape-models folder'
    );
  }

  if (!consent) {
    throw new ApiError(
      400,
      'Explicit consent is required to process and store full-body shape models'
    );
  }

  if (bytes && bytes > 10 * 1024 * 1024) {
    throw new ApiError(400, 'Shape model file size exceeds maximum limit of 10MB');
  }

  // 1. Check for existing active model
  const existingActive = await shapeModelRepository.findActiveByUserId(userId);
  if (existingActive) {
    await shapeModelRepository.markReplaced(existingActive._id, new Date());

    // Best-effort cleanup of old Cloudinary authenticated asset
    try {
      await uploadService.deleteFile(existingActive.publicId, { type: 'authenticated' });
    } catch (err) {
      logger.warn('Failed to delete replaced shape model Cloudinary asset:', {
        publicId: existingActive.publicId,
        error: err.message,
      });
    }
  }

  // 2. Create new active model
  const created = await shapeModelRepository.create({
    userId,
    publicId: imageRef,
    imageUrl: `authenticated://${imageRef}`,
    format,
    bytes,
    width,
    height,
    status: 'active',
    consentAt: new Date(),
  });

  return toShapeModelDto(created);
};

/**
 * Retrieves the currently active ShapeModel for a user.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<Object|null>} Mapped DTO with 1-hour signed URL, or null if none
 */
export const getActive = async (userId) => {
  const active = await shapeModelRepository.findActiveByUserId(userId);
  if (!active) {
    return null;
  }
  return toShapeModelDto(active);
};

/**
 * Soft-deletes the user's active ShapeModel and destroys the Cloudinary asset.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export const deleteActive = async (userId) => {
  const active = await shapeModelRepository.findActiveByUserId(userId);
  if (!active) {
    throw new ApiError(404, 'No active shape model found');
  }

  await shapeModelRepository.softDelete(active._id, new Date());

  try {
    await uploadService.deleteFile(active.publicId, { type: 'authenticated' });
  } catch (err) {
    logger.warn('Failed to destroy Cloudinary asset on shape model delete:', {
      publicId: active.publicId,
      error: err.message,
    });
  }

  return {
    success: true,
    message: 'Shape model deleted successfully',
  };
};

/**
 * Resolves a ShapeModel by ID ensuring active status and user ownership.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} shapeModelId
 * @returns {Promise<import('./shape-model.model.js').ShapeModel>}
 */
export const getShapeModelById = async (userId, shapeModelId) => {
  const model = await shapeModelRepository.findById(shapeModelId);
  if (!model) {
    throw new ApiError(404, 'Shape model not found');
  }

  if (model.userId.toString() !== userId.toString()) {
    throw new ApiError(403, 'Forbidden: You do not own this shape model');
  }

  if (model.status !== 'active') {
    throw new ApiError(400, 'The requested shape model is no longer active');
  }

  return model;
};

export default {
  createOrReplace,
  getActive,
  deleteActive,
  getShapeModelById,
};
