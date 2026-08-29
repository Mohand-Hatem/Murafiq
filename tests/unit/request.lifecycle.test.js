import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockFindById = jest.fn();
const mockUpdateById = jest.fn();
const mockCreate = jest.fn();
const mockFindUserById = jest.fn();
const mockCapacity = jest.fn();
const mockConsume = jest.fn();
const mockRefundQuota = jest.fn();

jest.unstable_mockModule('../../src/modules/requests/request.repository.js', () => ({
  default: {
    findById: mockFindById,
    updateById: mockUpdateById,
    create: mockCreate,
    expireOldRequests: jest.fn(),
  },
  findById: mockFindById,
  updateById: mockUpdateById,
  create: mockCreate,
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: mockFindUserById,
  },
  findById: mockFindUserById,
}));

jest.unstable_mockModule('../../src/modules/subscriptions/entitlement.service.js', () => ({
  default: {
    capacity: mockCapacity,
    consume: mockConsume,
    refundQuota: mockRefundQuota,
  },
  capacity: mockCapacity,
  consume: mockConsume,
  refundQuota: mockRefundQuota,
}));

const { createRequest, editRequest, reactivateRequest, cancelRequest, closeRequest } = await import(
  '../../src/modules/requests/request.service.js'
);

describe('Request Lifecycle & Immutability (Unit)', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const requestId = '60f719b8f1a2c81234567888';

  const mockClientUser = {
    _id: clientId,
    id: clientId,
    role: 'client',
    verification: { status: 'verified' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUserById.mockResolvedValue(mockClientUser);
    mockCapacity.mockResolvedValue({ limit: 4, used: 1, available: 3, hasCapacity: true });
    mockConsume.mockResolvedValue({ success: true, used: 1, limit: 4 });
  });

  describe('createRequest', () => {
    it('consumes daily quota and checks active capacity', async () => {
      mockCreate.mockResolvedValueOnce({
        _id: requestId,
        clientId,
        status: 'OPEN',
        offerCount: 0,
        pauseCount: 0,
        toObject: () => ({ _id: requestId, clientId, status: 'OPEN' }),
      });

      const result = await createRequest(mockClientUser, {
        title: 'Wedding Styling',
        visibility: 'broadcast',
      });

      expect(mockCapacity).toHaveBeenCalledWith(clientId, 'requests.active', 'client');
      expect(mockConsume).toHaveBeenCalledWith(clientId, 'requests.daily', 1, 'client');
      expect(result).toBeDefined();
    });

    it('rejects creation when active capacity is full', async () => {
      mockCapacity.mockResolvedValueOnce({ limit: 1, used: 1, available: 0, hasCapacity: false });

      await expect(
        createRequest(mockClientUser, { title: 'New Request', visibility: 'broadcast' })
      ).rejects.toThrow(/Active request capacity reached/);
    });
  });

  describe('editRequest', () => {
    it('allows full edit when offerCount is 0', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'OPEN',
        offerCount: 0,
      };
      mockFindById.mockResolvedValueOnce(mockReq);
      mockUpdateById.mockResolvedValueOnce({
        ...mockReq,
        title: 'Updated Title',
        toObject: () => ({ ...mockReq, title: 'Updated Title' }),
      });

      const result = await editRequest(clientId, requestId, { title: 'Updated Title' });

      expect(result).toBeDefined();
      expect(mockUpdateById).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({ title: 'Updated Title' })
      );
    });

    it('rejects modifying price/time/scope when offers exist (409 Conflict)', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'OPEN',
        offerCount: 2, // 2 active bids exist
      };
      mockFindById.mockResolvedValueOnce(mockReq);

      await expect(
        editRequest(clientId, requestId, { title: 'Changed Scope Title' })
      ).rejects.toThrow(/Request details are frozen after receiving 2 offer\(s\)/);
    });

    it('allows appending images even when offers exist', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'OPEN',
        offerCount: 2,
      };
      mockFindById.mockResolvedValueOnce(mockReq);
      mockUpdateById.mockResolvedValueOnce({
        ...mockReq,
        images: ['https://example.com/new.jpg'],
        toObject: () => ({ ...mockReq, images: ['https://example.com/new.jpg'] }),
      });

      const result = await editRequest(clientId, requestId, { images: ['https://example.com/new.jpg'] });
      expect(result).toBeDefined();
      expect(mockUpdateById).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({ images: ['https://example.com/new.jpg'] })
      );
    });
  });

  describe('reactivateRequest', () => {
    it('reactivates a PAUSED request when pauseCount < 3 and capacity is available', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'PAUSED',
        pauseCount: 1,
      };
      mockFindById.mockResolvedValueOnce(mockReq);
      mockUpdateById.mockResolvedValueOnce({
        ...mockReq,
        status: 'OPEN',
        toObject: () => ({ ...mockReq, status: 'OPEN' }),
      });

      const result = await reactivateRequest(clientId, requestId);

      expect(result).toBeDefined();
      expect(mockCapacity).toHaveBeenCalledWith(clientId, 'requests.active', 'client');
      expect(mockUpdateById).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({ status: 'OPEN' })
      );
    });

    it('permanently closes request and throws error when pauseCount >= 3', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'PAUSED',
        pauseCount: 3, // reached ceiling
      };
      mockFindById.mockResolvedValueOnce(mockReq);

      await expect(reactivateRequest(clientId, requestId)).rejects.toThrow(
        /reached the maximum of 3 reactivations and has been permanently closed/
      );
      expect(mockUpdateById).toHaveBeenCalledWith(requestId, { status: 'CLOSED' });
    });
  });

  describe('cancelRequest Quota Refund Grace', () => {
    it('refunds daily quota when cancelled within 15 minutes with 0 offers', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'OPEN',
        offerCount: 0,
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      };
      mockFindById.mockResolvedValueOnce(mockReq);
      mockUpdateById.mockResolvedValueOnce({
        ...mockReq,
        status: 'CANCELLED',
        toObject: () => ({ ...mockReq, status: 'CANCELLED' }),
      });

      await cancelRequest(clientId, requestId);

      expect(mockRefundQuota).toHaveBeenCalledWith(clientId, 'requests.daily', 1);
    });

    it('does NOT refund quota when cancelled after 15 minutes', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'OPEN',
        offerCount: 0,
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      };
      mockFindById.mockResolvedValueOnce(mockReq);
      mockUpdateById.mockResolvedValueOnce({
        ...mockReq,
        status: 'CANCELLED',
        toObject: () => ({ ...mockReq, status: 'CANCELLED' }),
      });

      await cancelRequest(clientId, requestId);

      expect(mockRefundQuota).not.toHaveBeenCalled();
    });
  });

  describe('closeRequest', () => {
    it('closes an open request', async () => {
      const mockReq = {
        _id: requestId,
        clientId: { _id: clientId, toString: () => clientId },
        status: 'OPEN',
      };
      mockFindById.mockResolvedValueOnce(mockReq);
      mockUpdateById.mockResolvedValueOnce({
        ...mockReq,
        status: 'CLOSED',
        toObject: () => ({ ...mockReq, status: 'CLOSED' }),
      });

      const result = await closeRequest(clientId, requestId);
      expect(result).toBeDefined();
      expect(mockUpdateById).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({ status: 'CLOSED' })
      );
    });
  });
});
