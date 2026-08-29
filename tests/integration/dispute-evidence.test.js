import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const adminId = '60f719b8f1a2c81234567899';
const bookingId = '60f719b8f1a2c81234567888';

const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
const stylistToken = generateAccessToken({ sub: stylistId, role: 'stylist' });
const adminToken = generateAccessToken({ sub: adminId, role: 'admin' });

const mockDisputedBooking = {
  _id: bookingId,
  clientId: { _id: clientId, name: 'Client User' },
  stylistId: { _id: stylistId, name: 'Stylist User' },
  status: 'disputed',
  price: 500,
  disputeDetails: {
    raisedBy: clientId,
    reason: 'Haircut did not match requested styling',
    evidence: [],
  },
};

const mockBookingFindById = jest.fn();
const mockBookingUpdateById = jest.fn();

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockBookingFindById,
    updateById: mockBookingUpdateById,
    findCompletedAndCancelledByStylistId: jest.fn().mockResolvedValue([]),
  },
  findById: mockBookingFindById,
  updateById: mockBookingUpdateById,
  findCompletedAndCancelledByStylistId: jest.fn().mockResolvedValue([]),
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) => {
      let role = 'client';
      if (id === stylistId) role = 'stylist';
      if (id === adminId) role = 'admin';
      return Promise.resolve({ _id: id, id, role, name: 'Test User' });
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/moderation/moderation.service.js', () => ({
  default: {
    scanAndEnforce: jest.fn().mockResolvedValue({ isAllowed: true, flagged: false }),
  },
  scanAndEnforce: jest.fn().mockResolvedValue({ isAllowed: true, flagged: false }),
}));

jest.unstable_mockModule('../../src/modules/stylists/reliability.service.js', () => ({
  default: {
    updateStylistReliability: jest.fn().mockResolvedValue({}),
  },
  updateStylistReliability: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../../src/modules/payments/payment.service.js', () => ({
  default: {
    processRefund: jest.fn().mockResolvedValue({}),
  },
  round2: (val) => Math.round(val * 100) / 100,
  processRefund: jest.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

describe('Stage R9 Integration — Dispute Evidence & Arbitration Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/bookings/:id/dispute/evidence', () => {
    it('allows participant to submit text and photo evidence', async () => {
      mockBookingFindById.mockResolvedValue(mockDisputedBooking);
      mockBookingUpdateById.mockResolvedValue({
        ...mockDisputedBooking,
        disputeDetails: {
          ...mockDisputedBooking.disputeDetails,
          evidence: [
            {
              submittedBy: clientId,
              text: 'Photo taken right after the session',
              images: ['https://example.com/photo.jpg'],
            },
          ],
        },
      });

      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/dispute/evidence`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          text: 'Photo taken right after the session',
          images: ['https://example.com/photo.jpg'],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/v1/bookings/:id/dispute', () => {
    it('returns dispute details and evidence timeline to participants', async () => {
      mockBookingFindById.mockResolvedValue(mockDisputedBooking);

      const res = await request(app)
        .get(`/api/v1/bookings/${bookingId}/dispute`)
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('disputeDetails');
      expect(res.body.data.status).toBe('disputed');
    });
  });

  describe('PATCH /api/v1/admin/bookings/:id/resolve-dispute', () => {
    it('allows admin to arbitrate dispute with split outcome', async () => {
      mockBookingFindById.mockResolvedValue(mockDisputedBooking);
      mockBookingUpdateById.mockResolvedValue({
        ...mockDisputedBooking,
        status: 'completed',
        disputeResolution: {
          outcome: 'split',
          refundPercentage: 50,
          resolutionNotes: 'Agreed on 50% refund to client',
        },
      });

      const res = await request(app)
        .patch(`/api/v1/admin/bookings/${bookingId}/resolve-dispute`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          outcome: 'split',
          refundPercentage: 50,
          resolutionNotes: 'Agreed on 50% refund to client',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
