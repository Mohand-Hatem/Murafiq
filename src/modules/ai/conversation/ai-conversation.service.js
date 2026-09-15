import * as conversationRepo from './ai-conversation.repository.js';

export const createConversation = async (userId, title) => {
  return conversationRepo.createConversation({
    userId,
    title: title || 'New Conversation',
  });
};

export const getConversation = async (id, userId) => {
  const conversation = await conversationRepo.findConversationById(id);
  if (!conversation) {
    return null;
  }
  if (userId && conversation.userId.toString() !== userId.toString()) {
    return null;
  }
  return conversation;
};

export const getUserConversations = async (userId, options = {}) => {
  const [items, total] = await Promise.all([
    conversationRepo.findUserConversations(userId, options),
    conversationRepo.countUserConversations(userId),
  ]);
  return { items, total };
};

export const addMessage = async (conversationId, userId, messageData) => {
  const conversation = await getConversation(conversationId, userId);
  if (!conversation) {
    throw new Error('Conversation not found or access denied');
  }

  const message = await conversationRepo.createMessage({
    conversationId,
    ...messageData,
  });

  await conversationRepo.updateConversation(conversationId, {
    lastMessageAt: message.createdAt || new Date(),
  });

  return message;
};

export const getConversationMessages = async (conversationId, userId, options = {}) => {
  const conversation = await getConversation(conversationId, userId);
  if (!conversation) {
    throw new Error('Conversation not found or access denied');
  }

  const [items, total] = await Promise.all([
    conversationRepo.findMessagesByConversationId(conversationId, options),
    conversationRepo.countMessagesByConversationId(conversationId),
  ]);

  return { items, total };
};

export const deleteConversation = async (id, userId) => {
  const conversation = await getConversation(id, userId);
  if (!conversation) {
    return null;
  }
  await conversationRepo.deleteMessagesByConversationId(id);
  return conversationRepo.deleteConversation(id, userId);
};

export const getMessageById = async (messageId, userId) => {
  const message = await conversationRepo.findMessageById(messageId);
  if (!message) {
    return null;
  }
  const conversation = await getConversation(message.conversationId, userId);
  if (!conversation) {
    return null;
  }
  return message;
};

export const updateMessage = async (messageId, updateData) => {
  return conversationRepo.updateMessageById(messageId, updateData);
};

export default {
  createConversation,
  getConversation,
  getUserConversations,
  addMessage,
  getConversationMessages,
  deleteConversation,
  getMessageById,
  updateMessage,
};
