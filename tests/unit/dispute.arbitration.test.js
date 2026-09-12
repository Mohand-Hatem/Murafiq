import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../../src/common/globals.js';

const mockBookingFindById = jest.fn();
const mockBookingUpdateById = jest.fn();
const mockBookingTransitionStatus = jest.fn((id, from, patch, session) =>
  session ? mockBookingUpdateById(id, patch, session) : mockBookingUpdateById(id, patch)
);
const mockPaymentProcessRefund = jest.fn();
const mockPaymentFindByBookingId = jest.fn();
const mockReliabilityUpdate = jest.fn();
const mockChatLock = jest.fn();
const mockChatOpen = jest.fn();
const mockScanAndEnforce = jest.fn().mockResolvedValue({ isAllowed: true, flagged: false });

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockBookingFindById,
    updateById: mockBookingUpdateById,
    transitionStatus: mockBookingTransitionStatus,
  },
  findById: mockBookingFindById,
  updateById: mockBookingUpdateById,
  transitionStatus: mockBookingTransitionStatus,
}));

jest.unstable_mockModule('../../src/modules/payments/payment.service.js', () => ({
  default: {
    processRefund: mockPaymentProcessRefund,
  },
  round2: (val) => Math.round(val * 100) / 100,
  processRefund: mockPaymentProcessRefund,
}));

jest.unstable_mockModule('../../src/modules/payments/payment.repository.js', () => ({
  default: {
    findByBookingId: mockPaymentFindByBookingId,
  },
  findByBookingId: mockPaymentFindByBookingId,
}));

jest.unstable_mockModule('../../src/modules/stylists/reliability.service.js', () => ({
  default: {
    updateStylistReliability: mockReliabilityUpdate,
  },
  updateStylistReliability: mockReliabilityUpdate,
}));

jest.unstable_mockModule('../../src/modules/chat/chat.service.js', () => ({
  default: {
    lockConversation: mockChatLock,
    openConversation: mockChatOpen,
  },
  lockConversation: mockChatLock,
  openConversation: mockChatOpen,
}));

jest.unstable_mockModule('../../src/modules/moderation/moderation.service.js', () => ({
  default: {
    scanAndEnforce: mockScanAndEnforce,
  },
  scanAndEnforce: mockScanAndEnforce,
}));

const { fileDispute, addDisputeEvidence, resolveDispute } = await import(
  '../../src/modules/bookings/booking.service.js'
);

describe('Dispute & Arbitration Engine (Unit)', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';
  const bookingId = '60f719b8f1a2c81234567888';
  const adminId = '60f719b8f1a2c81234567899';

  const clientUser = { _id: clientId, id: clientId, role: 'client' };
  const stylistUser = { _id: stylistId, id: stylistId, role: 'stylist' };
  const outsiderUser = { _id: '60f719b8f1a2c81234567800', id: '60f719b8f1a2c81234567800', role: 'client' };

  beforeEach(() => {
    jest.clearAllMocks();
    // resolveDispute looks this up to compute the stylist's fee-split share of a
    // partial-refund's retained amount; irrelevant to most tests here, so a sane default.
    mockPaymentFindByBookingId.mockResolvedValue({ amount: 1000, platformFeePercentage: 15 });
  });

  describe('fileDispute — 48h Window', () => {
    it('rejects dispute filed after 48 hours of completion with 400', async () => {
      const staleBooking = {
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'completed',
        completedAt: new Date(Date.now() - 50 * 3600 * 1000), // 50 hours ago
      };
      mockBookingFindById.mockResolvedValueOnce(staleBooking);

      await expect(
        fileDispute(clientUser, bookingId, { reason: 'Stylist was late' })
      ).rejects.toThrow(/Dispute filing window expired/i);
    });

    it('successfully opens dispute within 48 hours', async () => {
      const activeBooking = {
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'completed',
        completedAt: new Date(Date.now() - 10 * 3600 * 1000), // 10 hours ago
      };
      mockBookingFindById.mockResolvedValueOnce(activeBooking);
      mockBookingUpdateById.mockResolvedValueOnce({
        ...activeBooking,
        status: 'disputed',
        disputeDetails: { reason: 'Cut was uneven' },
      });

      const res = await fileDispute(clientUser, bookingId, { reason: 'Cut was uneven' });
      expect(res.status).toBe('disputed');
      expect(mockBookingUpdateById).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({ status: 'disputed' })
      );
    });

    it('refuses to file dispute if booking is no longer disputable after the read (CAS race)', async () => {
      const activeBooking = {
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'completed',
        completedAt: new Date(Date.now() - 10 * 3600 * 1000),
      };
      mockBookingFindById.mockResolvedValueOnce(activeBooking);
      mockBookingTransitionStatus.mockResolvedValueOnce(null);

      await expect(
        fileDispute(clientUser, bookingId, { reason: 'Cut was uneven' })
      ).rejects.toThrow(/no longer disputable/i);
    });
  });

  describe('addDisputeEvidence', () => {
    const disputedBooking = {
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'disputed',
    };

    it('allows client or stylist participant to submit evidence', async () => {
      mockBookingFindById.mockResolvedValueOnce(disputedBooking);
      mockBookingUpdateById.mockResolvedValueOnce({ ...disputedBooking });

      await addDisputeEvidence(stylistUser, bookingId, {
        text: 'I arrived on time and client confirmed satisfaction',
        images: ['https://example.com/proof.jpg'],
      });

      expect(mockBookingUpdateById).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({
          $push: {
            'disputeDetails.evidence': expect.objectContaining({
              submittedBy: stylistId,
              text: 'I arrived on time and client confirmed satisfaction',
              images: ['https://example.com/proof.jpg'],
            }),
          },
        })
      );
    });

    it('rejects outsider submission with 403 Forbidden', async () => {
      mockBookingFindById.mockResolvedValueOnce(disputedBooking);

      await expect(
        addDisputeEvidence(outsiderUser, bookingId, { text: 'Spam evidence' })
      ).rejects.toThrow(/Forbidden/i);
    });
  });

  describe('resolveDispute — Arbitration Outcomes & Reliability Recalculation', () => {
    const disputedBooking = {
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'disputed',
    };

    it('executes refund_full: 100% refund, marks cancelled, triggers reliability recalculation', async () => {
      mockBookingFindById.mockResolvedValueOnce(disputedBooking);
      mockBookingUpdateById.mockResolvedValueOnce({
        ...disputedBooking,
        status: 'cancelled',
      });

      await resolveDispute(adminId, bookingId, {
        outcome: 'refund_full',
        resolutionNotes: 'Stylist failed to show up',
      });

      expect(mockPaymentProcessRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          refundPercentage: 100,
        })
      );
      expect(mockBookingUpdateById).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({
          status: 'cancelled',
          disputeResolution: expect.objectContaining({
            outcome: 'refund_full',
            refundPercentage: 100,
          }),
        })
      );
      expect(mockReliabilityUpdate).toHaveBeenCalledWith(stylistId);
      expect(mockChatLock).toHaveBeenCalledWith(bookingId);
    });

    it('executes split: custom refund percentage, marks completed, triggers reliability recalculation', async () => {
      mockBookingFindById.mockResolvedValueOnce(disputedBooking);
      mockBookingUpdateById.mockResolvedValueOnce({
        ...disputedBooking,
        status: 'completed',
      });

      await resolveDispute(adminId, bookingId, {
        outcome: 'split',
        refundPercentage: 40,
        resolutionNotes: 'Partial service delivered',
      });

      expect(mockPaymentProcessRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          refundPercentage: 40,
        })
      );
      expect(mockBookingUpdateById).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({
          status: 'completed',
          disputeResolution: expect.objectContaining({
            outcome: 'split',
            refundPercentage: 40,
          }),
        })
      );
      expect(mockReliabilityUpdate).toHaveBeenCalledWith(stylistId);
    });

    it('executes payout_stylist / dismissed: 0% refund, marks completed', async () => {
      mockBookingFindById.mockResolvedValueOnce(disputedBooking);
      mockBookingUpdateById.mockResolvedValueOnce({
        ...disputedBooking,
        status: 'completed',
      });

      await resolveDispute(adminId, bookingId, {
        outcome: 'payout_stylist',
        resolutionNotes: 'Evidence showed service was performed satisfactorily',
      });

      expect(mockPaymentProcessRefund).not.toHaveBeenCalled();
      expect(mockBookingUpdateById).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({
          status: 'completed',
          disputeResolution: expect.objectContaining({
            outcome: 'payout_stylist',
            refundPercentage: 0,
          }),
        })
      );
      expect(mockReliabilityUpdate).toHaveBeenCalledWith(stylistId);
    });

    it('refuses to resolve dispute if booking left disputed status after read (CAS race)', async () => {
      mockBookingFindById.mockResolvedValueOnce(disputedBooking);
      mockBookingTransitionStatus.mockResolvedValueOnce(null);

      await expect(
        resolveDispute(adminId, bookingId, {
          outcome: 'payout_stylist',
          resolutionNotes: 'Dismissed',
        })
      ).rejects.toThrow(/no longer in disputed status/i);
    });
  });
});
