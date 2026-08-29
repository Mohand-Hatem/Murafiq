import PolicyViolation from './policy-violation.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [doc] = await PolicyViolation.create([data], options);
  return doc;
};

export const findById = async (id, session = null) => {
  const query = PolicyViolation.findById(id).populate('userId', 'name email role');
  if (session) query.session(session);
  return query;
};

export const countActiveByUserId = async (userId, session = null) => {
  const query = PolicyViolation.countDocuments({
    userId,
    status: 'ACTIVE',
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  });
  if (session) query.session(session);
  return query;
};

export const findActiveByUserId = async (userId, session = null) => {
  const query = PolicyViolation.find({
    userId,
    status: 'ACTIVE',
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  }).sort({ createdAt: -1 });
  if (session) query.session(session);
  return query;
};

export const updateById = async (id, data, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;
  return PolicyViolation.findByIdAndUpdate(id, data, options);
};

export default {
  create,
  findById,
  countActiveByUserId,
  findActiveByUserId,
  updateById,
};
