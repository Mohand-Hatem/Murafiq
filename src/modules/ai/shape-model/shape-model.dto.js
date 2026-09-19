import uploadService from '../../uploads/upload.service.js';

/**
 * Transforms a raw ShapeModel document into a client-safe DTO.
 * Conceals raw Cloudinary URLs and generates a 1-hour signed URL.
 *
 * @param {import('./shape-model.model.js').ShapeModel} doc
 * @param {number} [signedUrlTtl=3600]
 * @returns {Object}
 */
export const toShapeModelDto = (doc, signedUrlTtl = 3600) => {
  if (!doc) return null;

  const id = doc._id ? doc._id.toString() : doc.id;
  const signedUrl = doc.publicId ? uploadService.getSignedUrl(doc.publicId, signedUrlTtl) : null;

  return {
    id,
    status: doc.status,
    format: doc.format,
    width: doc.width || 0,
    height: doc.height || 0,
    bytes: doc.bytes || 0,
    signedUrl,
    consentAt: doc.consentAt,
    createdAt: doc.createdAt,
    replacedAt: doc.replacedAt || null,
  };
};

export default {
  toShapeModelDto,
};
