import { jest } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const mockClient = {
  _id: '60f719b8f1a2c81234567891',
  nameEn: 'Booking Client',
  email: 'client@test.com',
  role: 'client',
  isEmailVerified: true,
  accountStatus: 'active',
  verification: { status: 'verified' },
  toObject: function () {
    return this;
  },
};

const mockStylist = {
  _id: '60f719b8f1a2c81234567890',
  nameEn: 'Booking Stylist',
  email: 'stylist@test.com',
  role: 'stylist',
  isEmailVerified: true,
  accountStatus: 'active',
  verification: { status: 'verified' },
  toObject: function () {
    return this;
  },
};

const mockRequestDoc = {
  _id: '80f719b8f1a2c81234567890',
  clientId: mockClient,
  stylistId: mockStylist,
  title: 'Personal Shopping Session',
  time: '10:00',
  date: new Date(),
  status: 'OPEN',
  toObject: function () {
    return this;
  },
};

const mockOfferDoc = {
  _id: '90f719b8f1a2c81234567890',
  requestId: mockRequestDoc._id,
  stylistId: mockStylist,
  clientId: mockClient,
  price: 250,
  duration: 120,
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

let mockBookingDoc = {
  _id: 'a0f719b8f1a2c81234567890',
  requestId: mockRequestDoc._id,
  offerId: mockOfferDoc._id,
  clientId: mockClient,
  stylistId: mockStylist,
  scheduledDate: mockRequestDoc.date,
  scheduledStartMinute: 600,
  scheduledEndMinute: 720,
  price: 250,
  duration: 120,
  status: 'confirmed',
  toObject: function () {
    return this;
  },
};

let mockOverlapBlock = null;

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) => {
      if (id === mockClient._id) return Promise.resolve(mockClient);
      if (id === mockStylist._id) return Promise.resolve(mockStylist);
      return Promise.resolve(null);
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/requests/request.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockRequestDoc)),
    updateById: jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockRequestDoc, ...data })),
    lockAndAccept: jest.fn().mockImplementation((_id) => Promise.resolve({ ...mockRequestDoc, status: 'FULFILLED' })),
  },
}));

jest.unstable_mockModule('../../src/modules/offers/offer.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockOfferDoc)),
    updateById: jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockOfferDoc, ...data })),
    findSiblingPendingOffers: jest.fn().mockResolvedValue([]),
    rejectSiblingOffers: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    create: jest.fn().mockImplementation((data) => Promise.resolve({ ...mockBookingDoc, ...data })),
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockBookingDoc)),
    findMine: jest.fn().mockResolvedValue({ items: [mockBookingDoc], meta: { total: 1 } }),
    findStylistBookings: jest.fn().mockResolvedValue({ items: [mockBookingDoc], meta: { total: 1 } }),
    updateById: jest.fn().mockImplementation((id, data) => {
      mockBookingDoc = { ...mockBookingDoc, ...data };
      return Promise.resolve(mockBookingDoc);
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/bookings/schedule.repository.js', () => ({
  default: {
    findOverlap: jest.fn().mockImplementation(() => Promise.resolve(mockOverlapBlock)),
    create: jest.fn().mockResolvedValue({ _id: 'b0f719b8f1a2c81234567890' }),
    deleteByBookingId: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

jest.unstable_mockModule('../../src/modules/payments/payment.repository.js', () => ({
  default: {
    create: jest.fn().mockResolvedValue({ _id: 'p0f719b8f1a2c81234567890', status: 'pending' }),
    findByBookingId: jest.fn().mockResolvedValue({
      _id: 'p0f719b8f1a2c81234567890',
      status: 'paid',
      amount: 1000,
      bookingId: 'c0f719b8f1a2c81234567890',
      clientId: '60f719b8f1a2c81234567891',
      providerTransactionId: 'mock_tx_123',
    }),
    updateById: jest.fn().mockImplementation((id, data) =>
      Promise.resolve({
        _id: 'p0f719b8f1a2c81234567890',
        bookingId: 'c0f719b8f1a2c81234567890',
        clientId: '60f719b8f1a2c81234567891',
        ...data,
      })
    ),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Phase 5 Integration — Bookings & Scheduling', () => {
  const clientToken = generateAccessToken({ sub: mockClient._id, role: 'client' });
  const stylistToken = generateAccessToken({ sub: mockStylist._id, role: 'stylist' });

  beforeEach(() => {
    mockOverlapBlock = null;
    mockBookingDoc = {
      _id: 'a0f719b8f1a2c81234567890',
      requestId: mockRequestDoc._id,
      offerId: mockOfferDoc._id,
      clientId: mockClient,
      stylistId: mockStylist,
      scheduledDate: mockRequestDoc.date,
      scheduledStartMinute: 600,
      scheduledEndMinute: 720,
      price: 250,
      duration: 120,
      status: 'confirmed',
      toObject: function () {
        return this;
      },
    };
  });

  describe('PATCH /api/v1/offers/:id/accept -> Atomic Booking Creation', () => {
    it('should create booking and block schedule when offer is accepted', async () => {
      const res = await request(app)
        .patch(`/api/v1/offers/${mockOfferDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('confirmed');
    });

    it('should return 409 if time slot overlaps with an existing block', async () => {
      mockOverlapBlock = { _id: 'block123', startMinute: 600, endMinute: 720 };

      const res = await request(app)
        .patch(`/api/v1/offers/${mockOfferDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already booked/i);
    });
  });

  describe('PATCH /api/v1/bookings/:id/check-in', () => {
    it('should record check-in and update status to in-progress', async () => {
      const res = await request(app)
        .patch(`/api/v1/bookings/${mockBookingDoc._id}/check-in`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ lat: 30.0444, lng: 31.2357 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in-progress');
    });
  });

  describe('PATCH /api/v1/bookings/:id/confirm-completion', () => {
    it('should transition to completed only when both client and stylist confirm on an in-progress booking', async () => {
      mockBookingDoc.status = 'in-progress';

      // 1. Client confirms
      let res = await request(app)
        .patch(`/api/v1/bookings/${mockBookingDoc._id}/confirm-completion`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in-progress'); // Still waiting for stylist

      // 2. Stylist confirms
      res = await request(app)
        .patch(`/api/v1/bookings/${mockBookingDoc._id}/confirm-completion`)
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
    });

    it('should return 400 when attempting to confirm completion on a cancelled booking', async () => {
      mockBookingDoc.status = 'cancelled';

      const res = await request(app)
        .patch(`/api/v1/bookings/${mockBookingDoc._id}/confirm-completion`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/in-progress/i);
    });

    it('should return 400 when attempting to confirm completion before check-in (status: confirmed)', async () => {
      mockBookingDoc.status = 'confirmed';

      const res = await request(app)
        .patch(`/api/v1/bookings/${mockBookingDoc._id}/confirm-completion`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/in-progress/i);
    });
  });

  describe('POST /api/v1/bookings/:id/dispute', () => {
    it('should file a dispute on a completed booking', async () => {
      mockBookingDoc.status = 'completed';
      mockBookingDoc.updatedAt = new Date();

      const res = await request(app)
        .post(`/api/v1/bookings/${mockBookingDoc._id}/dispute`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Stylist was late by 1 hour', type: 'no_show' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('disputed');
    });
  });

  describe('PATCH /api/v1/bookings/:id/cancel', () => {
    it('should cancel booking and release schedule block', async () => {
      mockBookingDoc.status = 'confirmed';

      const res = await request(app)
        .patch(`/api/v1/bookings/${mockBookingDoc._id}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Need to reschedule' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });
  });
});
