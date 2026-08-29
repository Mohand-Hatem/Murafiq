import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const bookingId = '60f719b8f1a2c81234567888';

const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
const stylistToken = generateAccessToken({ sub: stylistId, role: 'stylist' });

const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000);

const mockBookingDoc = {
  _id: bookingId,
  clientId: { _id: clientId, name: 'Client User', toString: () => clientId },
  stylistId: { _id: stylistId, name: 'Stylist User', toString: () => stylistId },
  scheduledDate: futureDate,
  scheduledStartMinute: 600,
  price: 500,
  status: 'confirmed',
  toObject: function () {
    return this;
  },
};

const mockFindBookingById = jest.fn().mockResolvedValue(mockBookingDoc);
const mockUpdateBookingById = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...mockBookingDoc, ...data })
);

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockFindBookingById,
    updateById: mockUpdateBookingById,
    findMine: jest.fn().mockResolvedValue({ items: [], meta: {} }),
  },
}));

jest.unstable_mockModule('../../src/modules/bookings/schedule.repository.js', () => ({
  default: {
    deleteByBookingId: jest.fn().mockResolvedValue({}),
  },
}));

jest.unstable_mockModule('../../src/modules/payments/payment.repository.js', () => ({
  default: {
    findByBookingId: jest.fn().mockResolvedValue({
      _id: 'pay-1',
      status: 'paid',
      amount: 500,
    }),
    updateById: jest.fn().mockResolvedValue({}),
  },
}));

jest.unstable_mockModule('../../src/modules/payments/payment.service.js', () => ({
  default: {
    processRefund: jest.fn().mockResolvedValue({}),
  },
  processRefund: jest.fn().mockResolvedValue({}),
  round2: (val) => Math.round(val * 100) / 100,
}));

jest.unstable_mockModule('../../src/modules/penalties/penalty.repository.js', () => ({
  default: {
    create: jest.fn().mockResolvedValue({ _id: 'pen-1' }),
  },
}));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: jest.fn().mockResolvedValue({ _id: 'led-1' }),
    egpToPiastres: (egp) => Math.round(egp * 100),
    piastresToEgp: (piastres) => Math.round(piastres) / 100,
  },
  postEntry: jest.fn().mockResolvedValue({ _id: 'led-1' }),
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (piastres) => Math.round(piastres) / 100,
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) =>
      Promise.resolve({
        _id: id,
        role: id === stylistId ? 'stylist' : 'client',
        verification: { status: 'verified' },
      })
    ),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Stage R6 Integration — Cancellation Quote & Execution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/bookings/:id/cancellation-quote', () => {
    it('returns 97% early client refund quote for future booking', async () => {
      const res = await request(app)
        .get(`/api/v1/bookings/${bookingId}/cancellation-quote`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.refundPercentage).toBe(97);
      expect(res.body.data.refundAmount).toBe(485); // 97% of 500
      expect(res.body.data.platformFeeAmount).toBe(15); // 3% of 500
    });
  });

  describe('PATCH /api/v1/bookings/:id/cancel', () => {
    it('cancels booking and executes refund for client', async () => {
      const res = await request(app)
        .patch(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Change of schedule' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdateBookingById).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({ status: 'cancelled', cancelledBy: 'client' }),
        null
      );
    });

    it('cancels booking as stylist', async () => {
      const res = await request(app)
        .patch(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({ reason: 'Stylist unavailable' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdateBookingById).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({ status: 'cancelled', cancelledBy: 'stylist' }),
        null
      );
    });
  });
});
