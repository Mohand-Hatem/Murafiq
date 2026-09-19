import uploadService from '../../uploads/upload.service.js';

/**
 * Transforms a raw TryOnGeneration document into a client-safe DTO.
 * Generates 1-hour signed URL for completed results and conceals raw Cloudinary paths.
 *
 * @param {import('./try-on-generation.model.js').TryOnGeneration} doc
 * @param {number} [signedUrlTtl=3600]
 * @returns {Object}
 */
export const toTryOnDto = (doc, signedUrlTtl = 3600) => {
  if (!doc) return null;

  const id = doc._id ? doc._id.toString() : doc.id;
  const shapeModelId = doc.shapeModelId ? doc.shapeModelId.toString() : null;
  const outfitId = doc.outfitId ? doc.outfitId.toString() : null;

  const garments = Array.isArray(doc.garments)
    ? doc.garments.map((g) => ({
        source: g.source,
        itemId: g.itemId ? g.itemId.toString() : null,
        imageRef: g.imageRef || null,
        slot: g.slot,
        label: g.label || '',
      }))
    : [];

  let result = null;
  if (doc.status === 'completed' && doc.resultPublicId) {
    const signedUrl = uploadService.getSignedUrl(doc.resultPublicId, signedUrlTtl);
    result = {
      signedUrl,
      completedAt: doc.completedAt,
    };
  }

  let error = null;
  if (doc.status === 'failed') {
    error = {
      message: doc.errorMessage || 'Try-On generation failed',
      failedAt: doc.failedAt,
    };
  }

  return {
    id,
    shapeModelId,
    outfitId,
    garments,
    status: doc.status,
    resolution: doc.resolution,
    promptVersion: doc.promptVersion,
    attempts: doc.attempts || 0,
    result,
    error,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export default {
  toTryOnDto,
};
