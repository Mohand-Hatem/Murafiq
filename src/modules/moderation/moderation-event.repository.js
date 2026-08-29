import ModerationEvent from './moderation-event.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [doc] = await ModerationEvent.create([data], options);
  return doc;
};

export const findById = async (id, session = null) => {
  const query = ModerationEvent.findById(id).populate('senderId', 'name email role');
  if (session) query.session(session);
  return query;
};

export const findPaginated = async (query = {}, pagination = { page: 1, limit: 20 }) => {
  const page = parseInt(pagination.page, 10) || 1;
  const limit = parseInt(pagination.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    ModerationEvent.find(query)
      .populate('senderId', 'name email role')
      .populate('recipientId', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ModerationEvent.countDocuments(query),
  ]);

  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const updateById = async (id, updateData, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;
  return ModerationEvent.findByIdAndUpdate(id, updateData, options).populate(
    'senderId',
    'name email role'
  );
};

export const findOpenUserReport = async (reporterId, conversationId, messageId) => {
  return ModerationEvent.findOne({
    recipientId: reporterId,
    conversationId: String(conversationId),
    matchedLayer: 'USER_REPORT',
    matchedRule: messageId ? `user_report:${messageId}` : 'user_report',
    reviewStatus: 'PENDING',
  });
};

export default {
  findOpenUserReport,
  create,
  findById,
  findPaginated,
  updateById,
};
