export const toMessageDto = (msg) => {
  if (!msg) return null;
  return {
    id: msg.id || msg._id,
    senderId: msg.senderId,
    type: msg.type || 'text',
    content: msg.content,
    deliveredAt: msg.deliveredAt || null,
    seenAt: msg.seenAt || null,
    createdAt: msg.createdAt,
  };
};

export const toConversationDto = (conv) => {
  if (!conv) return null;
  return {
    id: conv.id || conv.bookingId,
    bookingId: conv.bookingId,
    participants: conv.participants || [],
    isOpen: Boolean(conv.isOpen),
    isLocked: Boolean(conv.isLocked),
    lastMessageAt: conv.lastMessageAt || null,
    createdAt: conv.createdAt,
  };
};

export default {
  toMessageDto,
  toConversationDto,
};
