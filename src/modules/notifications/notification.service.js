import { messaging } from '../../config/firebase.config.js';
import notificationRepository from './notification.repository.js';
import userRepository from '../users/user.repository.js';
import logger from '../../config/logger.config.js';

class NotificationService {
  /**
   * Create an in-app notification in MongoDB and dispatch live push notification via FCM
   */
  async send(userId, { type, title, body, relatedEntityId = null }) {
    const stringUserId = String(userId);

    // 1. Persist notification in MongoDB (source of truth for in-app activity feed)
    const notification = await notificationRepository.create({
      userId: stringUserId,
      type,
      title,
      body,
      relatedEntityId: relatedEntityId ? String(relatedEntityId) : null,
      isRead: false,
    });

    // 2. Dispatch FCM push notification to active device tokens
    try {
      const user = await userRepository.findById(stringUserId);
      if (user && Array.isArray(user.fcmTokens) && user.fcmTokens.length > 0 && messaging) {
        const payload = {
          tokens: user.fcmTokens,
          notification: {
            title,
            body,
          },
          data: {
            type: String(type),
            relatedEntityId: relatedEntityId ? String(relatedEntityId) : '',
            notificationId: String(notification._id),
          },
        };

        const response = await messaging.sendEachForMulticast(payload);
        logger.info(`FCM multicast sent for user ${stringUserId}: ${response.successCount} succeeded, ${response.failureCount} failed`);

        // 3. Clean up stale/invalid tokens
        if (response.failureCount > 0) {
          const failedTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const errorCode = resp.error?.code;
              if (
                errorCode === 'messaging/invalid-registration-token' ||
                errorCode === 'messaging/registration-token-not-registered'
              ) {
                failedTokens.push(user.fcmTokens[idx]);
              }
            }
          });

          if (failedTokens.length > 0) {
            await userRepository.updateById(stringUserId, {
              $pull: { fcmTokens: { $in: failedTokens } },
            });
            logger.info(`Pruned ${failedTokens.length} expired FCM token(s) for user ${stringUserId}`);
          }
        }
      }
    } catch (err) {
      logger.warn(`Push notification dispatch failed for user ${stringUserId}: ${err.message}`);
    }

    return notification;
  }

  /**
   * Register a new device FCM token on the user's account
   */
  async registerDeviceToken(userId, fcmToken) {
    if (!fcmToken || typeof fcmToken !== 'string') {
      throw new ApiError(400, 'Valid FCM token string is required');
    }

    const trimmedToken = fcmToken.trim();
    await userRepository.updateById(userId, {
      $addToSet: { fcmTokens: trimmedToken },
    });

    return { success: true, message: 'Device token registered successfully' };
  }

  /**
   * Unregister an FCM token upon logout or app uninstallation
   */
  async removeDeviceToken(userId, fcmToken) {
    if (!fcmToken || typeof fcmToken !== 'string') {
      throw new ApiError(400, 'Valid FCM token string is required');
    }

    const trimmedToken = fcmToken.trim();
    await userRepository.updateById(userId, {
      $pull: { fcmTokens: trimmedToken },
    });

    return { success: true, message: 'Device token removed successfully' };
  }

  /**
   * Get paginated user notifications
   */
  async getUserNotifications(userId, queryString) {
    return notificationRepository.findUserNotifications(userId, queryString);
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(userId, notificationId) {
    const updated = await notificationRepository.markAsRead(userId, notificationId);
    if (!updated) {
      throw new ApiError(404, 'Notification not found');
    }
    return updated;
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId) {
    await notificationRepository.markAllAsRead(userId);
    return { success: true, message: 'All notifications marked as read' };
  }

  /**
   * Get count of unread notifications for notification badge counter
   */
  async getUnreadCount(userId) {
    const count = await notificationRepository.countUnread(userId);
    return { unreadCount: count };
  }
}

export const notificationService = new NotificationService();
export default notificationService;
