import BlockedWord from './blocked-word.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [doc] = await BlockedWord.create([data], options);
  return doc;
};

export const createMany = async (dataArray, session = null) => {
  const options = session ? { session } : {};
  return BlockedWord.insertMany(dataArray, options);
};

export const findAllActive = async (session = null) => {
  const query = BlockedWord.find({ isActive: true });
  if (session) query.session(session);
  return query;
};

export const findAllActiveWords = async (session = null) => {
  const docs = await findAllActive(session);
  return docs.map((d) => ({
    id: d._id.toString(),
    word: d.word,
    language: d.language,
    category: d.category,
    severity: d.severity,
  }));
};

export const findById = async (id, session = null) => {
  const query = BlockedWord.findById(id);
  if (session) query.session(session);
  return query;
};

export const findByWord = async (word, session = null) => {
  const query = BlockedWord.findOne({ word: word.toLowerCase().trim() });
  if (session) query.session(session);
  return query;
};

export const deleteById = async (id, session = null) => {
  const query = BlockedWord.findByIdAndDelete(id);
  if (session) query.session(session);
  return query;
};

export const findAllPaginated = async ({ query = {}, sort = { createdAt: -1 }, skip = 0, limit = 20 } = {}) => {
  const [items, total] = await Promise.all([
    BlockedWord.find(query).sort(sort).skip(skip).limit(limit),
    BlockedWord.countDocuments(query),
  ]);
  return { items, total };
};

export default {
  create,
  createMany,
  findAllActive,
  findAllActiveWords,
  findById,
  findByWord,
  deleteById,
  findAllPaginated,
};
