import TryOnGeneration from './try-on-generation.model.js';

/**
 * Creates a new TryOnGeneration record.
 * @param {Object} data
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration>}
 */
export const create = async (data) => {
  return TryOnGeneration.create(data);
};

/**
 * Finds a generation by its ID.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const findById = async (id) => {
  return TryOnGeneration.findById(id);
};

/**
 * Finds a generation by its ID and user (enforcing ownership).
 * @param {string|import('mongoose').Types.ObjectId} id
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const findByIdAndUser = async (id, userId) => {
  return TryOnGeneration.findOne({ _id: id, userId });
};

/**
 * Finds an active (pending or processing) generation for a given deterministic jobId.
 * @param {string} jobId
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const findActiveByJobId = async (jobId) => {
  return TryOnGeneration.findOne({
    jobId,
    status: { $in: ['pending', 'processing'] },
  }).sort({ createdAt: -1 });
};

/**
 * Finds a completed generation for a given deterministic jobId completed after cutoffDate.
 * @param {string} jobId
 * @param {Date} cutoffDate
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const findRecentCompletedByJobId = async (jobId, cutoffDate) => {
  return TryOnGeneration.findOne({
    jobId,
    status: 'completed',
    completedAt: { $gte: cutoffDate },
  }).sort({ completedAt: -1 });
};

/**
 * Updates generation status and relevant metadata.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @param {Object} updateData
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const updateById = async (id, updateData) => {
  return TryOnGeneration.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
};

/**
 * Increments the execution attempt counter.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const incrementAttempts = async (id) => {
  return TryOnGeneration.findByIdAndUpdate(
    id,
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
};

/**
 * Marks generation as completed with Cloudinary output asset.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @param {Object} result
 * @param {string} result.resultPublicId
 * @param {string} result.resultUrl
 * @param {Date} [result.completedAt=new Date()]
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const markCompleted = async (id, { resultPublicId, resultUrl, completedAt = new Date() }) => {
  return TryOnGeneration.findByIdAndUpdate(
    id,
    {
      status: 'completed',
      resultPublicId,
      resultUrl,
      completedAt,
    },
    { returnDocument: 'after' }
  );
};

/**
 * Marks generation as failed.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @param {Object} failure
 * @param {string} failure.errorMessage
 * @param {Date} [failure.failedAt=new Date()]
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const markFailed = async (id, { errorMessage, failedAt = new Date() }) => {
  return TryOnGeneration.findByIdAndUpdate(
    id,
    {
      status: 'failed',
      errorMessage,
      failedAt,
    },
    { returnDocument: 'after' }
  );
};

/**
 * Marks quota as refunded on terminal failure.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @returns {Promise<import('./try-on-generation.model.js').TryOnGeneration|null>}
 */
export const markQuotaRefunded = async (id) => {
  return TryOnGeneration.findByIdAndUpdate(
    id,
    { quotaRefunded: true },
    { returnDocument: 'after' }
  );
};

/**
 * Lists user try-on generations with pagination.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {Object} pagination
 * @param {number} [pagination.page=1]
 * @param {number} [pagination.limit=20]
 * @returns {Promise<{ docs: Array, total: number, page: number, totalPages: number }>}
 */
export const listUserGenerations = async (userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    TryOnGeneration.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    TryOnGeneration.countDocuments({ userId }),
  ]);

  return {
    docs,
    total,
    page,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

export default {
  create,
  findById,
  findByIdAndUser,
  findActiveByJobId,
  findRecentCompletedByJobId,
  updateById,
  incrementAttempts,
  markCompleted,
  markFailed,
  markQuotaRefunded,
  listUserGenerations,
};
