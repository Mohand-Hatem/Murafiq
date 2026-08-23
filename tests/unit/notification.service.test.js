import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import notificationService from '../../src/modules/notifications/notification.service.js';
import notificationRepository from '../../src/modules/notifications/notification.repository.js';
import userRepository from '../../src/modules/users/user.repository.js';

describe('Notification Service Unit Tests', () => {
  const userId = '60f719b8f1a2c81234567890';
  const notificationId = '60f719b8f1a2c81234567895';
  const testToken = 'fcm_test_token_abcdef123456';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates and persists in-app notification in database', async () => {
    const mockCreated = {
      _id: notificationId,
      userId,
      type: 'booking',
      title: 'Booking Confirmed',
      body: 'Your session has been scheduled.',
      relatedEntityId: '60f719b8f1a2c81234567891',
      isRead: false,
    };

    jest.spyOn(notificationRepository, 'create').mockResolvedValue(mockCreated);
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: userId,
      fcmTokens: [],
    });

    const result = await notificationService.send(userId, {
      type: 'booking',
      title: 'Booking Confirmed',
      body: 'Your session has been scheduled.',
      relatedEntityId: '60f719b8f1a2c81234567891',
    });

    expect(result._id).toBe(notificationId);
    expect(result.title).toBe('Booking Confirmed');
    expect(notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        type: 'booking',
        title: 'Booking Confirmed',
        body: 'Your session has been scheduled.',
      })
    );
  });

  it('registers a new device FCM token on the user document', async () => {
    jest.spyOn(userRepository, 'updateById').mockResolvedValue({
      _id: userId,
      fcmTokens: [testToken],
    });

    const res = await notificationService.registerDeviceToken(userId, testToken);
    expect(res.success).toBe(true);
    expect(userRepository.updateById).toHaveBeenCalledWith(userId, {
      $addToSet: { fcmTokens: testToken },
    });
  });

  it('removes an FCM token on logout', async () => {
    jest.spyOn(userRepository, 'updateById').mockResolvedValue({
      _id: userId,
      fcmTokens: [],
    });

    const res = await notificationService.removeDeviceToken(userId, testToken);
    expect(res.success).toBe(true);
    expect(userRepository.updateById).toHaveBeenCalledWith(userId, {
      $pull: { fcmTokens: testToken },
    });
  });

  it('marks a single notification as read', async () => {
    jest.spyOn(notificationRepository, 'markAsRead').mockResolvedValue({
      _id: notificationId,
      userId,
      isRead: true,
    });

    const updated = await notificationService.markAsRead(userId, notificationId);
    expect(updated.isRead).toBe(true);
    expect(notificationRepository.markAsRead).toHaveBeenCalledWith(userId, notificationId);
  });

  it('marks all user notifications as read', async () => {
    jest.spyOn(notificationRepository, 'markAllAsRead').mockResolvedValue({
      acknowledged: true,
      modifiedCount: 5,
    });

    const res = await notificationService.markAllAsRead(userId);
    expect(res.success).toBe(true);
    expect(notificationRepository.markAllAsRead).toHaveBeenCalledWith(userId);
  });

  it('calculates unread notifications count', async () => {
    jest.spyOn(notificationRepository, 'countUnread').mockResolvedValue(4);

    const res = await notificationService.getUnreadCount(userId);
    expect(res.unreadCount).toBe(4);
    expect(notificationRepository.countUnread).toHaveBeenCalledWith(userId);
  });
});
