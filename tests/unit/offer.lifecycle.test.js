import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockOfferFindById = jest.fn();
const mockOfferUpdateById = jest.fn();
const mockOfferCreate = jest.fn();
const mockCountByStylistAndRequest = jest.fn();
const mockCloseSiblingOffers = jest.fn();
const mockExpireOldOffers = jest.fn();

const mockRequestFindById = jest.fn();
const mockRequestUpdateById = jest.fn();

const mockUserFindById = jest.fn();
const mockCapacity = jest.fn();
const mockConsume = jest.fn();

jest.unstable_mockModule('../../src/modules/offers/offer.repository.js', () => ({
  default: {
    findById: mockOfferFindById,
    updateById: mockOfferUpdateById,
    create: mockOfferCreate,
    countByStylistAndRequest: mockCountByStylistAndRequest,
    closeSiblingOffers: mockCloseSiblingOffers,
    expireOldOffers: mockExpireOldOffers,
  },
  findById: mockOfferFindById,
  updateById: mockOfferUpdateById,
  create: mockOfferCreate,
  countByStylistAndRequest: mockCountByStylistAndRequest,
  closeSiblingOffers: mockCloseSiblingOffers,
  expireOldOffers: mockExpireOldOffers,
}));

jest.unstable_mockModule('../../src/modules/requests/request.repository.js', () => ({
  default: {
    findById: mockRequestFindById,
    updateById: mockRequestUpdateById,
  },
  findById: mockRequestFindById,
  updateById: mockRequestUpdateById,
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: mockUserFindById,
  },
  findById: mockUserFindById,
}));

jest.unstable_mockModule('../../src/modules/subscriptions/entitlement.service.js', () => ({
  default: {
    capacity: mockCapacity,
    consume: mockConsume,
  },
  capacity: mockCapacity,
  consume: mockConsume,
}));

const { createOffer, withdrawOffer } = await import('../../src/modules/offers/offer.service.js');
const { sweepExpiredOffers } = await import('../../src/jobs/offer-expiry.cron.js');

describe('Offer Lifecycle Revision (Unit)', () => {
  const stylistId = '60f719b8f1a2c81234567890';
  const clientId = '60f719b8f1a2c81234567891';
  const requestId = '60f719b8f1a2c81234567888';
  const offerId = '60f719b8f1a2c81234567877';

  const mockStylistUser = {
    _id: stylistId,
    id: stylistId,
    role: 'stylist',
    verification: { status: 'verified' },
  };

  const mockRequest = {
    _id: requestId,
    clientId: { _id: clientId, toString: () => clientId },
    visibility: 'broadcast',
    status: 'OPEN',
    offerCount: 1,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindById.mockResolvedValue(mockStylistUser);
    mockRequestFindById.mockResolvedValue(mockRequest);
    mockCapacity.mockResolvedValue({ limit: 6, used: 2, available: 4, hasCapacity: true });
    mockConsume.mockResolvedValue({ success: true, used: 3, limit: 6 });
    mockCountByStylistAndRequest.mockResolvedValue(0); // 0 existing bids
  });

  describe('createOffer — Multi-bid & Quota Gates', () => {
    it('creates an offer on the request within limit', async () => {
      mockOfferCreate.mockResolvedValueOnce({
        _id: offerId,
        stylistId,
        requestId,
        price: 350,
        duration: 90,
        status: 'PENDING',
        toObject: () => ({ _id: offerId, stylistId, requestId, price: 350 }),
      });

      const result = await createOffer(mockStylistUser, requestId, { price: 350, duration: 90 });

      expect(mockCapacity).toHaveBeenCalledWith(stylistId, 'offers.active', 'stylist');
      expect(mockConsume).toHaveBeenCalledWith(stylistId, 'offers.daily', 1, 'stylist');
      expect(mockCountByStylistAndRequest).toHaveBeenCalledWith(stylistId, requestId);
      expect(mockRequestUpdateById).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({ $inc: { offerCount: 1 } })
      );
      expect(result).toBeDefined();
    });

    it('rejects offer when stylist has already placed an offer on this request', async () => {
      mockCountByStylistAndRequest.mockResolvedValueOnce(1); // Already placed 1 bid

      await expect(
        createOffer(mockStylistUser, requestId, { price: 300, duration: 60 })
      ).rejects.toThrow(/Maximum of 1 offer per request reached/);
    });

    it('rejects offer when active offer capacity is exhausted', async () => {
      mockCapacity.mockResolvedValueOnce({ limit: 3, used: 3, available: 0, hasCapacity: false });

      await expect(
        createOffer(mockStylistUser, requestId, { price: 300, duration: 60 })
      ).rejects.toThrow(/Active offer capacity reached/);
    });
  });

  describe('withdrawOffer', () => {
    it('allows stylist to withdraw their pending offer and decrements request offerCount', async () => {
      const mockOffer = {
        _id: offerId,
        stylistId: { _id: stylistId, toString: () => stylistId },
        requestId,
        status: 'PENDING',
      };
      mockOfferFindById.mockResolvedValueOnce(mockOffer);
      mockOfferUpdateById.mockResolvedValueOnce({
        ...mockOffer,
        status: 'WITHDRAWN',
        toObject: () => ({ ...mockOffer, status: 'WITHDRAWN' }),
      });

      const result = await withdrawOffer(mockStylistUser, offerId);

      expect(result).toBeDefined();
      expect(mockOfferUpdateById).toHaveBeenCalledWith(offerId, { status: 'WITHDRAWN' });
      expect(mockRequestUpdateById).toHaveBeenCalledWith(requestId, { $inc: { offerCount: -1 } });
    });

    it('rejects withdrawal if the offer is not authored by this stylist', async () => {
      const otherStylistOffer = {
        _id: offerId,
        stylistId: { _id: 'other-stylist-id', toString: () => 'other-stylist-id' },
        status: 'PENDING',
      };
      mockOfferFindById.mockResolvedValueOnce(otherStylistOffer);

      await expect(withdrawOffer(mockStylistUser, offerId)).rejects.toThrow(/Forbidden/);
    });
  });

  describe('sweepExpiredOffers', () => {
    it('sweeps expired offers and returns modified count', async () => {
      mockExpireOldOffers.mockResolvedValueOnce({ modifiedCount: 4 });

      const summary = await sweepExpiredOffers();
      expect(summary.modifiedCount).toBe(4);
      expect(mockExpireOldOffers).toHaveBeenCalled();
    });
  });
});
