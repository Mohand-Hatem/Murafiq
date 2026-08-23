import { jest } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import chatService from '../../src/modules/chat/chat.service.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const outsiderId = '60f719b8f1a2c81234567899';
const bookingId = '60f719b8f1a2c81234567888';
const notificationId = '60f719b8f1a2c81234567877';

const mockNotification = {
  _id: notificationId,
  userId: clientId,
  type: 'booking',
  title: 'Booking Confirmed',
  body: 'Your session has been scheduled.',
  relatedEntityId: bookingId,
  isRead: false,
  createdAt: new Date(),
  toObject: function () {
    return this;
  },
};

const mockFindUserNotifications = jest.fn().mockResolvedValue({
  items: [mockNotification],
  meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
});
const mockCountUnread = jest.fn().mockResolvedValue(1);
const mockMarkAsRead = jest.fn().mockResolvedValue({ ...mockNotification, isRead: true });
const mockMarkAllAsRead = jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
const mockCreateNotification = jest.fn().mockResolvedValue(mockNotification);

jest.unstable_mockModule('../../src/modules/notifications/notification.repository.js', () => ({
  default: {
    findUserNotifications: mockFindUserNotifications,
    countUnread: mockCountUnread,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
    create: mockCreateNotification,
  },
  findUserNotifications: mockFindUserNotifications,
  countUnread: mockCountUnread,
  markAsRead: mockMarkAsRead,
  markAllAsRead: mockMarkAllAsRead,
  create: mockCreateNotification,
}));

const mockUser = {
  _id: clientId,
  fcmTokens: [],
  role: 'client',
  accountStatus: 'active',
  isDeleted: false,
};

const mockFindUserById = jest.fn().mockResolvedValue(mockUser);
const mockUpdateUserById = jest.fn().mockResolvedValue({ ...mockUser, fcmTokens: ['token_123'] });

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: mockFindUserById,
    updateById: mockUpdateUserById,
    softDelete: jest.fn(),
    findVerifications: jest.fn(),
  },
  findById: mockFindUserById,
  updateById: mockUpdateUserById,
}));

const { default: app } = await import('../../src/app.js');

describe('Phase 7 Integration — Chat & Notifications Endpoints', () => {
  const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
  const stylistToken = generateAccessToken({ sub: stylistId, role: 'stylist' });
  const outsiderToken = generateAccessToken({ sub: outsiderId, role: 'client' });

  beforeEach(async () => {
    await chatService.createConversation(bookingId, [clientId, stylistId]);
  });

  describe('Chat Endpoints (/api/v1/chat)', () => {
    it('POST /chat/token generates a custom Firebase token for authenticated client', async () => {
      const res = await request(app)
        .post('/api/v1/chat/token')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
    });

    it('POST /chat/:conversationId/messages rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/chat/${bookingId}/messages`)
        .send({ content: 'Hello' });

      expect(res.status).toBe(401);
    });

    it('POST /chat/:conversationId/messages rejects when room is closed (unpaid) with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chat/${bookingId}/messages`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ content: 'Hello before payment' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Chat is not open yet');
    });

    it('POST /chat/:conversationId/messages succeeds with 201 when room is open', async () => {
      await chatService.openConversation(bookingId);

      const res = await request(app)
        .post(`/api/v1/chat/${bookingId}/messages`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ content: 'Hello stylist!', type: 'text' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Hello stylist!');
      expect(res.body.data.senderId).toBe(clientId);
    });

    it('GET /chat/:conversationId/messages fetches history for participant', async () => {
      await chatService.openConversation(bookingId);

      const res = await request(app)
        .get(`/api/v1/chat/${bookingId}/messages`)
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.conversation).toBeDefined();
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it('GET /chat/:conversationId/messages rejects non-participant with 403', async () => {
      await chatService.openConversation(bookingId);

      const res = await request(app)
        .get(`/api/v1/chat/${bookingId}/messages`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Notifications Endpoints (/api/v1/notifications)', () => {
    it('GET /notifications fetches paginated notifications', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.meta.total).toBe(1);
    });

    it('GET /notifications/unread-count returns unread count', async () => {
      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.unreadCount).toBe(1);
    });

    it('PATCH /notifications/:id/read marks notification as read', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isRead).toBe(true);
    });

    it('PATCH /notifications/read-all marks all as read', async () => {
      const res = await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /notifications/device-token registers an FCM device token', async () => {
      const res = await request(app)
        .post('/api/v1/notifications/device-token')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ token: 'test_device_fcm_token_123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('DELETE /notifications/device-token unregisters an FCM device token', async () => {
      const res = await request(app)
        .delete('/api/v1/notifications/device-token')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ token: 'test_device_fcm_token_123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
