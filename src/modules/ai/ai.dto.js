/**
 * Mobile Data Transfer Object (DTO) mappers for the AI module.
 * Sanitizes and formats documents into stable, mobile-friendly responses.
 */

export const toMobileConversationDto = (conv) => {
  if (!conv) return null;
  return {
    id: conv._id ? conv._id.toString() : String(conv.id),
    title: conv.title || 'New Conversation',
    lastMessageAt: conv.lastMessageAt || conv.updatedAt || conv.createdAt,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
};

export const toMobileMessageDto = (msg) => {
  if (!msg) return null;
  return {
    id: msg._id ? msg._id.toString() : String(msg.id),
    conversationId: msg.conversationId ? msg.conversationId.toString() : null,
    role: msg.role,
    content: msg.content,
    imageUrl: msg.imageUrl || null,
    structuredResult: msg.structuredResult || null,
    matchedWardrobeItemId: msg.matchedWardrobeItemId ? msg.matchedWardrobeItemId.toString() : null,
    savedWardrobeItemId: msg.savedWardrobeItemId ? msg.savedWardrobeItemId.toString() : null,
    createdAt: msg.createdAt,
  };
};

export const toMobileOutfitDto = (outfit) => {
  if (!outfit) return null;
  return {
    id: outfit._id ? outfit._id.toString() : String(outfit.id),
    userId: outfit.userId ? outfit.userId.toString() : null,
    conversationId: outfit.conversationId ? outfit.conversationId.toString() : null,
    items: Array.isArray(outfit.items) ? outfit.items : [],
    anchorItemId: outfit.anchorItemId ? outfit.anchorItemId.toString() : null,
    externalSuggestions: Array.isArray(outfit.externalSuggestions) ? outfit.externalSuggestions : [],
    eventContext: outfit.eventContext || {},
    rationale: outfit.rationale || '',
    score: outfit.score !== undefined ? outfit.score : null,
    source: outfit.source || 'wardrobe',
    userFeedback: outfit.userFeedback || null,
    createdAt: outfit.createdAt,
    updatedAt: outfit.updatedAt,
  };
};

export const toMobileStylistRequestDto = (req) => {
  if (!req) return null;
  return {
    requestId: req.requestId,
    status: req.status,
    responseType: req.responseType,
    searchStatus: req.searchStatus,
    assistantMessage: req.assistantMessage,
    result: req.result || null,
  };
};

export default {
  toMobileConversationDto,
  toMobileMessageDto,
  toMobileOutfitDto,
  toMobileStylistRequestDto,
};
