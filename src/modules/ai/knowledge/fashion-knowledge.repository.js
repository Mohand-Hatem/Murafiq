import FashionKnowledgeDoc from './fashion-knowledge.model.js';

/**
 * Upsert a single fashion knowledge chunk.
 * If a chunk with the same slug and chunkIndex exists, it is updated in place.
 *
 * @param {Object} chunkData
 * @returns {Promise<Object>}
 */
export const upsertChunk = async (chunkData) => {
  const { slug, chunkIndex } = chunkData;
  return FashionKnowledgeDoc.findOneAndUpdate(
    { slug, chunkIndex },
    { $set: chunkData },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );
};

/**
 * Find a chunk by slug and chunkIndex.
 *
 * @param {string} slug
 * @param {number} chunkIndex
 * @returns {Promise<Object|null>}
 */
export const findBySlugAndChunk = async (slug, chunkIndex) => {
  return FashionKnowledgeDoc.findOne({ slug, chunkIndex }).lean();
};

/**
 * Find all chunks belonging to a specific topic.
 *
 * @param {string} topic
 * @returns {Promise<Array>}
 */
export const findChunksByTopic = async (topic) => {
  return FashionKnowledgeDoc.find({ topic }).sort({ chunkIndex: 1 }).lean();
};

/**
 * List all knowledge chunks across all topics.
 *
 * @returns {Promise<Array>}
 */
export const listAllChunks = async () => {
  return FashionKnowledgeDoc.find({}).sort({ slug: 1, chunkIndex: 1 }).lean();
};

/**
 * Count total knowledge chunks.
 *
 * @param {Object} [filter={}]
 * @returns {Promise<number>}
 */
export const countChunks = async (filter = {}) => {
  return FashionKnowledgeDoc.countDocuments(filter);
};

/**
 * Fallback keyword / text search across knowledge chunks in MongoDB.
 *
 * @param {string} query
 * @param {Object} [options={}]
 * @param {string} [options.topic]
 * @param {number} [options.limit=3]
 * @returns {Promise<Array>}
 */
export const searchByText = async (query, { topic, limit = 3 } = {}) => {
  const filter = {};
  if (topic) {
    filter.topic = topic;
  }

  if (query && typeof query === 'string' && query.trim()) {
    // Try text search first, fallback to regex search if text index not populated
    try {
      const textResults = await FashionKnowledgeDoc.find(
        { ...filter, $text: { $search: query } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();

      if (textResults.length > 0) {
        return textResults;
      }
    } catch {
      // If text index search fails, fallback to regex matching
    }

    const regex = new RegExp(query.trim().split(/\s+/).join('|'), 'i');
    return FashionKnowledgeDoc.find({
      ...filter,
      $or: [{ title: regex }, { body: regex }],
    })
      .limit(limit)
      .lean();
  }

  return FashionKnowledgeDoc.find(filter).limit(limit).lean();
};

export default {
  upsertChunk,
  findBySlugAndChunk,
  findChunksByTopic,
  listAllChunks,
  countChunks,
  searchByText,
};
