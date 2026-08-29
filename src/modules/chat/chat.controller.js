import moderationService from '../moderation/moderation.service.js';
import chatService from './chat.service.js';
import { toMessageDto, toConversationDto } from './chat.dto.js';

export const getChatToken = asyncHandler(async (req, res) => {
  const token = await chatService.generateChatToken(req.user._id || req.user.id, req.user.role);
  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Chat token generated successfully',
    data: { token },
  });
});

export const getMessages = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const result = await chatService.getMessages(
    conversationId,
    req.user._id || req.user.id,
    req.user.role,
    req.query
  );

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Messages fetched successfully',
    data: {
      conversation: toConversationDto(result.conversation),
      items: result.items.map(toMessageDto),
      nextCursor: result.nextCursor,
    },
  });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const message = await chatService.sendMessage(
    conversationId,
    req.user._id || req.user.id,
    req.body
  );

  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Message sent successfully',
    data: toMessageDto(message),
  });
});

export const reportMessage = asyncHandler(async (req, res) => {
  const result = await moderationService.reportContent(req.user.id, {
    conversationId: req.params.conversationId,
    messageId: req.body.messageId,
    reportedUserId: req.body.reportedUserId,
    reason: req.body.reason,
    snippet: req.body.snippet,
  });
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Report submitted. Our team will review it.',
    data: result,
  });
});

export default {
  reportMessage,
  getChatToken,
  getMessages,
  sendMessage,
};
