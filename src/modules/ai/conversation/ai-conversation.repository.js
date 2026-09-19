import AiConversation from './ai-conversation.model.js';
import AiMessage from './ai-message.model.js';

export const createConversation = async ({ userId, title }) => {
  return AiConversation.create({ userId, title });
};

export const findConversationById = async (id) => {
  return AiConversation.findById(id);
};

export const findUserConversations = async (userId, { limit = 20, skip = 0 } = {}) => {
  return AiConversation.find({ userId })
    .sort({ lastMessageAt: -1 })
    .skip(skip)
    .limit(limit);
};

export const countUserConversations = async (userId) => {
  return AiConversation.countDocuments({ userId });
};

export const updateConversation = async (id, updateData) => {
  return AiConversation.findByIdAndUpdate(
    id,
    { $set: updateData },
    { returnDocument: 'after', runValidators: true }
  );
};

export const deleteConversation = async (id, userId) => {
  return AiConversation.findOneAndDelete({ _id: id, userId });
};

export const createMessage = async (messageData) => {
  return AiMessage.create(messageData);
};

export const findMessagesByConversationId = async (conversationId, { limit = 50, skip = 0 } = {}) => {
  return AiMessage.find({ conversationId })
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);
};

export const countMessagesByConversationId = async (conversationId) => {
  return AiMessage.countDocuments({ conversationId });
};

export const deleteMessagesByConversationId = async (conversationId) => {
  return AiMessage.deleteMany({ conversationId });
};

export const findMessageById = async (id) => {
  return AiMessage.findById(id);
};

export const updateMessageById = async (id, updateData) => {
  return AiMessage.findByIdAndUpdate(id, { $set: updateData }, { new: true });
};

export const findExpiredImageMessages = async (cutoffDate = new Date(), limit = 500) => {
  return AiMessage.find({
    imageExpiresAt: { $lte: cutoffDate },
    savedWardrobeItemId: null,
    imageRef: { $ne: null },
  }).limit(limit);
};

export default {
  createConversation,
  findConversationById,
  findUserConversations,
  countUserConversations,
  updateConversation,
  deleteConversation,
  createMessage,
  findMessageById,
  updateMessageById,
  findExpiredImageMessages,
  findMessagesByConversationId,
  countMessagesByConversationId,
  deleteMessagesByConversationId,
};
