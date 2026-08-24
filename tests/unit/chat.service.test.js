import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import chatService from '../../src/modules/chat/chat.service.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';
import chatListener from '../../src/modules/chat/chat.listener.js';

chatListener.register();

describe('Chat Service Unit Tests', () => {
  const bookingId = '60f719b8f1a2c81234567891';
  const clientUserId = '60f719b8f1a2c81234567890';
  const stylistUserId = '60f719b8f1a2c81234567892';
  const outsiderUserId = '60f719b8f1a2c81234567899';

  beforeEach(async () => {
    // Re-create a fresh closed room before each test
    await chatService.createConversation(bookingId, [clientUserId, stylistUserId]);
    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({ _id: bookingId, status: 'disputed' });
  });

  describe('Lifecycle State Transitions', () => {
    it('initializes a conversation as closed and unlocked', async () => {
      const conv = await chatService.getConversation(bookingId);
      expect(conv).toBeDefined();
      expect(conv.isOpen).toBe(false);
      expect(conv.isLocked).toBe(false);
      expect(conv.participants).toContain(clientUserId);
      expect(conv.participants).toContain(stylistUserId);
    });

    it('opens the conversation when PAYMENT_SUCCEEDED event is emitted', async () => {
      eventBus.emit(EVENTS.PAYMENT_SUCCEEDED, { bookingId });

      const conv = await chatService.getConversation(bookingId);
      expect(conv.isOpen).toBe(true);
      expect(conv.isLocked).toBe(false);
    });

    it('locks the conversation when SESSION_COMPLETED event is emitted', async () => {
      await chatService.openConversation(bookingId);
      eventBus.emit(EVENTS.SESSION_COMPLETED, { bookingId });

      const conv = await chatService.getConversation(bookingId);
      expect(conv.isLocked).toBe(true);
    });

    it('locks the conversation when BOOKING_CANCELLED event is emitted', async () => {
      await chatService.openConversation(bookingId);
      eventBus.emit(EVENTS.BOOKING_CANCELLED, { bookingId });

      const conv = await chatService.getConversation(bookingId);
      expect(conv.isLocked).toBe(true);
    });
  });

  describe('Access Control & Token Minting', () => {
    it('generates a custom chat token with the requested role claim', async () => {
      const token = await chatService.generateChatToken(clientUserId, ROLES.CLIENT);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token).toContain(clientUserId);
    });

    it('allows participants to fetch messages', async () => {
      await chatService.openConversation(bookingId);
      const res = await chatService.getMessages(bookingId, clientUserId, ROLES.CLIENT);
      expect(res.conversation).toBeDefined();
      expect(Array.isArray(res.items)).toBe(true);
    });

    it('allows Admin to view message history of disputed conversation', async () => {
      await chatService.openConversation(bookingId);
      const res = await chatService.getMessages(bookingId, outsiderUserId, ROLES.ADMIN);
      expect(res.conversation).toBeDefined();
      expect(Array.isArray(res.items)).toBe(true);
    });

    it('rejects Admin when booking has no active dispute', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({ _id: bookingId, status: 'confirmed' });
      await chatService.openConversation(bookingId);
      await expect(
        chatService.getMessages(bookingId, outsiderUserId, ROLES.ADMIN)
      ).rejects.toThrow(/restricted to disputed/i);
    });

    it('rejects non-participant non-admin with 403 Forbidden', async () => {
      await chatService.openConversation(bookingId);
      await expect(
        chatService.getMessages(bookingId, outsiderUserId, ROLES.CLIENT)
      ).rejects.toThrow('You do not have access to this conversation');
    });
  });

  describe('Message Sending Guards', () => {
    it('rejects sending a message if conversation is not open yet (unpaid)', async () => {
      await expect(
        chatService.sendMessage(bookingId, clientUserId, { content: 'Hello stylist!' })
      ).rejects.toThrow('Chat is not open yet');
    });

    it('rejects sending a message if sender is not a participant', async () => {
      await chatService.openConversation(bookingId);
      await expect(
        chatService.sendMessage(bookingId, outsiderUserId, { content: 'Intruder message' })
      ).rejects.toThrow('You are not a participant in this conversation');
    });

    it('rejects sending a message if conversation is locked', async () => {
      await chatService.openConversation(bookingId);
      await chatService.lockConversation(bookingId);

      await expect(
        chatService.sendMessage(bookingId, clientUserId, { content: 'Trying to chat after end' })
      ).rejects.toThrow('Chat is locked');
    });

    it('successfully sends a message when room is open and active', async () => {
      await chatService.openConversation(bookingId);

      const msg = await chatService.sendMessage(bookingId, clientUserId, {
        content: 'Hello! Looking forward to our styling session.',
        type: 'text',
      });

      expect(msg.id).toBeDefined();
      expect(msg.senderId).toBe(clientUserId);
      expect(msg.content).toBe('Hello! Looking forward to our styling session.');
      expect(msg.type).toBe('text');

      const history = await chatService.getMessages(bookingId, stylistUserId, ROLES.STYLIST);
      expect(history.items.length).toBeGreaterThanOrEqual(1);
      expect(history.items.some((m) => m.content === msg.content)).toBe(true);
    });
  });
});
