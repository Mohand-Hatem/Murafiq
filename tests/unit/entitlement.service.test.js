import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockFindActiveByUserId = jest.fn();
const mockFindByCode = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
const mockCountRequests = jest.fn();
const mockCountOffers = jest.fn();

jest.unstable_mockModule('../../src/modules/subscriptions/subscription.repository.js', () => ({
  default: {
    findActiveByUserId: mockFindActiveByUserId,
  },
  findActiveByUserId: mockFindActiveByUserId,
}));

jest.unstable_mockModule('../../src/modules/subscriptions/plan.repository.js', () => ({
  default: {
    findByCode: mockFindByCode,
  },
  findByCode: mockFindByCode,
}));

jest.unstable_mockModule('../../src/modules/subscriptions/usage-counter.model.js', () => ({
  default: {
    findOneAndUpdate: mockFindOneAndUpdate,
    updateOne: mockUpdateOne,
  },
}));

jest.unstable_mockModule('../../src/modules/requests/request.model.js', () => ({
  default: {
    countDocuments: mockCountRequests,
  },
}));

jest.unstable_mockModule('../../src/modules/offers/offer.model.js', () => ({
  default: {
    countDocuments: mockCountOffers,
  },
}));

const { getEntitlements, consume, capacity, hasFeature, refundQuota } = await import(
  '../../src/modules/subscriptions/entitlement.service.js'
);

describe('Entitlement Service (Unit)', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getEntitlements', () => {
    it('returns free tier fallbacks when user has no active subscription', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce(null);

      const result = await getEntitlements(clientId, 'client');

      expect(result.planCode).toBe('client.free');
      expect(result.tier).toBe('free');
      expect(result.entitlements['requests.daily']).toBe(1);
      expect(result.entitlements['ai.messages.daily']).toBe(3);
    });

    it('returns plan entitlements when user has an active paid subscription', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({
        planCode: 'client.pro',
      });
      mockFindByCode.mockResolvedValueOnce({
        code: 'client.pro',
        tier: 'pro',
        entitlements: {
          'requests.daily': 4,
          'requests.active': 4,
          'ai.messages.daily': 80,
          'wardrobe.photos.max': 100,
        },
      });

      const result = await getEntitlements(clientId, 'client');

      expect(result.planCode).toBe('client.pro');
      expect(result.tier).toBe('pro');
      expect(result.entitlements['requests.daily']).toBe(4);
      expect(result.entitlements['ai.messages.daily']).toBe(80);
    });
  });

  describe('consume', () => {
    it('successfully consumes daily quota within limit', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({ planCode: 'client.free' });
      mockFindByCode.mockResolvedValueOnce({
        code: 'client.free',
        tier: 'free',
        entitlements: { 'requests.daily': 1 },
      });

      mockFindOneAndUpdate.mockResolvedValueOnce({ used: 1 });

      const result = await consume(clientId, 'requests.daily', 1, 'client');

      expect(result.success).toBe(true);
      expect(result.used).toBe(1);
      expect(result.limit).toBe(1);
    });

    it('throws 429 ApiError when daily quota is exceeded (code 11000 duplicate key)', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({ planCode: 'client.free' });
      mockFindByCode.mockResolvedValueOnce({
        code: 'client.free',
        tier: 'free',
        entitlements: { 'requests.daily': 1 },
      });

      mockFindOneAndUpdate.mockRejectedValueOnce({
        code: 11000,
        message: 'E11000 duplicate key error',
      });

      await expect(consume(clientId, 'requests.daily', 1, 'client')).rejects.toThrow(
        /Daily quota exceeded for requests.daily/
      );
    });
  });

  describe('capacity', () => {
    it('calculates live capacity for active requests', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({ planCode: 'client.pro' });
      mockFindByCode.mockResolvedValueOnce({
        code: 'client.pro',
        tier: 'pro',
        entitlements: { 'requests.active': 4 },
      });

      mockCountRequests.mockResolvedValueOnce(2);

      const result = await capacity(clientId, 'requests.active', 'client');

      expect(result.limit).toBe(4);
      expect(result.used).toBe(2);
      expect(result.available).toBe(2);
      expect(result.hasCapacity).toBe(true);
    });

    it('reports hasCapacity: false when active requests reach limit', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({ planCode: 'client.free' });
      mockFindByCode.mockResolvedValueOnce({
        code: 'client.free',
        tier: 'free',
        entitlements: { 'requests.active': 1 },
      });

      mockCountRequests.mockResolvedValueOnce(1);

      const result = await capacity(clientId, 'requests.active', 'client');

      expect(result.limit).toBe(1);
      expect(result.used).toBe(1);
      expect(result.available).toBe(0);
      expect(result.hasCapacity).toBe(false);
    });
  });

  describe('hasFeature', () => {
    it('returns true for stylist pro priority feed', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({ planCode: 'stylist.pro' });
      mockFindByCode.mockResolvedValueOnce({
        code: 'stylist.pro',
        tier: 'pro',
        entitlements: { 'feed.priority': true },
      });

      const hasPriority = await hasFeature(stylistId, 'feed.priority', 'stylist');
      expect(hasPriority).toBe(true);
    });

    it('returns false for stylist free priority feed', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce(null);

      const hasPriority = await hasFeature(stylistId, 'feed.priority', 'stylist');
      expect(hasPriority).toBe(false);
    });
  });

  describe('refundQuota', () => {
    it('decrements the usage counter for given metric', async () => {
      mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      await refundQuota(clientId, 'requests.daily', 1);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: clientId,
          metric: 'requests.daily',
        }),
        { $inc: { used: -1 } }
      );
    });
  });
});
