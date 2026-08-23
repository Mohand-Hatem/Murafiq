import notificationService from './notification.service.js';
import { toNotificationDto } from './notification.dto.js';

export const getMyNotifications = asyncHandler(async (req, res) => {
  const { items, meta } = await notificationService.getUserNotifications(
    req.user._id || req.user.id,
    req.query
  );

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Notifications fetched successfully',
    data: {
      items: items.map(toNotificationDto),
    },
    meta,
  });
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await notificationService.getUnreadCount(req.user._id || req.user.id);
  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Unread count fetched successfully',
    data: result,
  });
});

export const markAsRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(
    req.user._id || req.user.id,
    req.params.id
  );

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Notification marked as read',
    data: toNotificationDto(notification),
  });
});

export const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllAsRead(req.user._id || req.user.id);
  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'All notifications marked as read',
    data: result,
  });
});

export const registerDeviceToken = asyncHandler(async (req, res) => {
  const result = await notificationService.registerDeviceToken(
    req.user._id || req.user.id,
    req.body.token
  );
  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Device token registered successfully',
    data: result,
  });
});

export const removeDeviceToken = asyncHandler(async (req, res) => {
  const result = await notificationService.removeDeviceToken(
    req.user._id || req.user.id,
    req.body.token
  );
  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Device token removed successfully',
    data: result,
  });
});

export default {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  registerDeviceToken,
  removeDeviceToken,
};
