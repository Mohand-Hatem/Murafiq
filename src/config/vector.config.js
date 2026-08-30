import { Index } from '@upstash/vector';
import env from './env.config.js';
import { logger } from './logger.config.js';

let vectorIndex = null;
const inMemoryTestIndex = new Map(); // For unit/integration test isolation

export const getVectorIndex = () => {
  if (!vectorIndex) {
    vectorIndex = new Index({
      url: env.UPSTASH_VECTOR_REST_URL,
      token: env.UPSTASH_VECTOR_REST_TOKEN,
    });
  }
  return vectorIndex;
};

/**
 * Get namespaced vector client for a specific user
 * @param {string} userId
 */
export const getUserVectorNamespace = (userId) => {
  const nsKey = userId.toString();

  if (env.NODE_ENV === 'test' || env.UPSTASH_VECTOR_REST_URL === 'https://dev-vector.upstash.io') {
    return {
      upsert: async ({ id, data, metadata }) => {
        if (!inMemoryTestIndex.has(nsKey)) {
          inMemoryTestIndex.set(nsKey, new Map());
        }
        inMemoryTestIndex.get(nsKey).set(id.toString(), { id, data, metadata });
        return { success: true };
      },
      delete: async (id) => {
        if (inMemoryTestIndex.has(nsKey)) {
          inMemoryTestIndex.get(nsKey).delete(id.toString());
        }
        return { success: true };
      },
      query: async ({ data: _data, topK = 5, filter: _filter }) => {
        if (!inMemoryTestIndex.has(nsKey)) {
          return [];
        }
        const userItems = Array.from(inMemoryTestIndex.get(nsKey).values());
        return userItems.slice(0, topK).map((item) => ({
          id: item.id,
          score: 0.95,
          metadata: item.metadata,
        }));
      },
    };
  }

  const index = getVectorIndex();
  const ns = index.namespace(nsKey);

  return {
    upsert: async ({ id, data, metadata }) => {
      try {
        return await ns.upsert({ id: id.toString(), data, metadata });
      } catch (err) {
        logger.error(`Upstash vector upsert error for user ${nsKey}:`, err);
        throw err;
      }
    },
    delete: async (id) => {
      try {
        return await ns.delete(id.toString());
      } catch (err) {
        logger.error(`Upstash vector delete error for user ${nsKey}:`, err);
        throw err;
      }
    },
    query: async ({ data, topK = 5, filter }) => {
      try {
        return await ns.query({ data, topK, filter });
      } catch (err) {
        logger.error(`Upstash vector query error for user ${nsKey}:`, err);
        throw err;
      }
    },
  };
};

export default {
  getVectorIndex,
  getUserVectorNamespace,
};
