import BlockedDomain from './blocked-domain.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [doc] = await BlockedDomain.create([data], options);
  return doc;
};

export const findAllActive = async (session = null) => {
  const query = BlockedDomain.find({ isActive: true });
  if (session) query.session(session);
  return query;
};

export const findAllActiveDomains = async (session = null) => {
  const docs = await findAllActive(session);
  return docs.map((d) => d.domain);
};

export const findById = async (id, session = null) => {
  const query = BlockedDomain.findById(id);
  if (session) query.session(session);
  return query;
};

export const deleteById = async (id, session = null) => {
  const query = BlockedDomain.findByIdAndDelete(id);
  if (session) query.session(session);
  return query;
};

export default {
  create,
  findAllActive,
  findAllActiveDomains,
  findById,
  deleteById,
};
