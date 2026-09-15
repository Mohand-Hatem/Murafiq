import ShapeModel from './shape-model.model.js';

/**
 * Creates a new ShapeModel record.
 * @param {Object} data
 * @returns {Promise<import('./shape-model.model.js').ShapeModel>}
 */
export const create = async (data) => {
  return ShapeModel.create(data);
};

/**
 * Finds the currently active ShapeModel for a given user.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<import('./shape-model.model.js').ShapeModel|null>}
 */
export const findActiveByUserId = async (userId) => {
  return ShapeModel.findOne({ userId, status: 'active' });
};

/**
 * Finds a ShapeModel by its ID.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @returns {Promise<import('./shape-model.model.js').ShapeModel|null>}
 */
export const findById = async (id) => {
  return ShapeModel.findById(id);
};

/**
 * Marks a ShapeModel as replaced.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @param {Date} [replacedAt=new Date()]
 * @returns {Promise<import('./shape-model.model.js').ShapeModel|null>}
 */
export const markReplaced = async (id, replacedAt = new Date()) => {
  return ShapeModel.findByIdAndUpdate(
    id,
    { status: 'replaced', replacedAt },
    { returnDocument: 'after' }
  );
};

/**
 * Soft-deletes an active ShapeModel.
 * @param {string|import('mongoose').Types.ObjectId} id
 * @param {Date} [deletedAt=new Date()]
 * @returns {Promise<import('./shape-model.model.js').ShapeModel|null>}
 */
export const softDelete = async (id, deletedAt = new Date()) => {
  return ShapeModel.findByIdAndUpdate(
    id,
    { status: 'deleted', deletedAt },
    { returnDocument: 'after' }
  );
};

/**
 * Lists all ShapeModels for a user chronologically.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<Array<import('./shape-model.model.js').ShapeModel>>}
 */
export const findAllByUserId = async (userId) => {
  return ShapeModel.find({ userId }).sort({ createdAt: -1 });
};

export default {
  create,
  findActiveByUserId,
  findById,
  markReplaced,
  softDelete,
  findAllByUserId,
};
