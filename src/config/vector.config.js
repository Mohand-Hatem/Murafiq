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
        let userItems = Array.from(inMemoryTestIndex.get(nsKey).values());
        if (_data && typeof _data === 'string' && _data.trim()) {
          const words = _data.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 2);
          if (words.length > 0) {
            userItems = userItems.filter((item) => {
              const content = String(item.data || '').toLowerCase();
              return words.some((word) => content.includes(word));
            });
          }
        }
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

let kbVectorIndex = null;
const inMemoryTestKbIndex = new Map(); // For unit/integration test isolation of knowledge vectors

export const getKnowledgeVectorIndex = () => {
  if (!kbVectorIndex) {
    kbVectorIndex = new Index({
      url: env.UPSTASH_KB_VECTOR_REST_URL,
      token: env.UPSTASH_KB_VECTOR_REST_TOKEN,
    });
  }
  return kbVectorIndex;
};

/**
 * Get namespaced vector client for fashion knowledge (namespaced by topic).
 * Upstash Vector indexes use built-in embeddings (bge-large-en-v1.5 / bge-m3).
 *
 * @param {string} [topic='default']
 */
export const getKnowledgeVectorNamespace = (topic = 'default') => {
  const nsKey = topic.toString();

  if (
    env.NODE_ENV === 'test' ||
    !env.UPSTASH_KB_VECTOR_REST_URL ||
    env.UPSTASH_KB_VECTOR_REST_URL === 'https://dev-kb-vector.upstash.io'
  ) {
    return {
      upsert: async ({ id, data, metadata }) => {
        if (!inMemoryTestKbIndex.has(nsKey)) {
          inMemoryTestKbIndex.set(nsKey, new Map());
        }
        inMemoryTestKbIndex.get(nsKey).set(id.toString(), { id, data, metadata });
        return { success: true };
      },
      delete: async (id) => {
        if (inMemoryTestKbIndex.has(nsKey)) {
          inMemoryTestKbIndex.get(nsKey).delete(id.toString());
        }
        return { success: true };
      },
      query: async ({ data: _data, topK = 3, filter: _filter }) => {
        if (!inMemoryTestKbIndex.has(nsKey)) {
          return [];
        }
        let items = Array.from(inMemoryTestKbIndex.get(nsKey).values());
        if (_data && typeof _data === 'string' && _data.trim()) {
          const words = _data.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 2);
          if (words.length > 0) {
            items = items.filter((item) => {
              const content = `${item.data || ''} ${JSON.stringify(item.metadata || {})}`.toLowerCase();
              return words.some((word) => content.includes(word));
            });
          }
        }
        return items.slice(0, topK).map((item) => ({
          id: item.id,
          score: 0.92,
          metadata: item.metadata,
        }));
      },
    };
  }

  const index = getKnowledgeVectorIndex();
  const ns = index.namespace(nsKey);

  return {
    upsert: async ({ id, data, metadata }) => {
      try {
        return await ns.upsert({ id: id.toString(), data, metadata });
      } catch (err) {
        logger.error(`Upstash KB vector upsert error for topic ${nsKey}:`, err);
        throw err;
      }
    },
    delete: async (id) => {
      try {
        return await ns.delete(id.toString());
      } catch (err) {
        logger.error(`Upstash KB vector delete error for topic ${nsKey}:`, err);
        throw err;
      }
    },
    query: async ({ data, topK = 3, filter }) => {
      try {
        return await ns.query({ data, topK, filter });
      } catch (err) {
        logger.error(`Upstash KB vector query error for topic ${nsKey}:`, err);
        throw err;
      }
    },
  };
};

export default {
  getVectorIndex,
  getUserVectorNamespace,
  getKnowledgeVectorIndex,
  getKnowledgeVectorNamespace,
};

