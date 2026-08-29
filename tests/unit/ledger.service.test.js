import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockCreateEntry = jest.fn();
const mockFindByIdempotencyKey = jest.fn();

jest.unstable_mockModule('../../src/modules/ledger/ledger.repository.js', () => ({
  default: {
    createEntry: mockCreateEntry,
    createEntries: jest.fn(),
    findByIdempotencyKey: mockFindByIdempotencyKey,
    findByBookingId: jest.fn(),
    findByPaymentId: jest.fn(),
    findByPayoutId: jest.fn(),
    findBySubjectId: jest.fn(),
    findByCorrelationId: jest.fn(),
    aggregateBookingBalance: jest.fn(),
  },
  createEntry: mockCreateEntry,
  findByIdempotencyKey: mockFindByIdempotencyKey,
}));

const { egpToPiastres, piastresToEgp, postEntry, postDoubleEntry } = await import(
  '../../src/modules/ledger/ledger.service.js'
);
const { default: LedgerEntry } = await import('../../src/modules/ledger/ledger-entry.model.js');

describe('Ledger Service (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Currency Conversion Math', () => {
    it('should accurately convert decimal EGP to integer piastres', () => {
      expect(egpToPiastres(100)).toBe(10000);
      expect(egpToPiastres(250.5)).toBe(25050);
      expect(egpToPiastres(99.99)).toBe(9999);
      expect(egpToPiastres(0)).toBe(0);
    });

    it('should throw error for invalid EGP amounts', () => {
      expect(() => egpToPiastres('invalid')).toThrow();
      expect(() => egpToPiastres(NaN)).toThrow();
    });

    it('should accurately convert integer piastres to decimal EGP', () => {
      expect(piastresToEgp(10000)).toBe(100);
      expect(piastresToEgp(25050)).toBe(250.5);
      expect(piastresToEgp(9999)).toBe(99.99);
      expect(piastresToEgp(0)).toBe(0);
    });
  });

  describe('Validation & Idempotency', () => {
    it('should throw if idempotencyKey is missing', async () => {
      await expect(
        postEntry({
          entryType: 'PAYMENT',
          accountType: 'CLIENT',
          direction: 'DEBIT',
          amountMinor: 50000,
        })
      ).rejects.toThrow('idempotencyKey is required');
    });

    it('should throw if amountMinor is not an integer or negative', async () => {
      await expect(
        postEntry({
          idempotencyKey: 'test:1',
          entryType: 'PAYMENT',
          accountType: 'CLIENT',
          direction: 'DEBIT',
          amountMinor: 50.5,
        })
      ).rejects.toThrow('must be a non-negative integer piastres value');
    });

    it('should return existing entry on duplicate key conflict (code 11000)', async () => {
      const mockExisting = {
        _id: '60f719b8f1a2c81234567899',
        idempotencyKey: 'payment:paid:client:123',
        entryType: 'PAYMENT',
        amountMinor: 50000,
      };

      mockCreateEntry.mockRejectedValueOnce({
        code: 11000,
        message: 'E11000 duplicate key error',
      });
      mockFindByIdempotencyKey.mockResolvedValueOnce(mockExisting);

      const result = await postEntry({
        idempotencyKey: 'payment:paid:client:123',
        entryType: 'PAYMENT',
        accountType: 'CLIENT',
        direction: 'DEBIT',
        amountMinor: 50000,
      });

      expect(result).toEqual(mockExisting);
      expect(mockFindByIdempotencyKey).toHaveBeenCalledWith('payment:paid:client:123');
    });
  });

  describe('Double Entry Posting', () => {
    it('should throw error if debit and credit amounts do not match', async () => {
      await expect(
        postDoubleEntry(
          { idempotencyKey: 'deb:1', entryType: 'PAYMENT', accountType: 'CLIENT', amountMinor: 1000 },
          { idempotencyKey: 'cred:1', entryType: 'ESCROW_HOLD', accountType: 'ESCROW', amountMinor: 2000 }
        )
      ).rejects.toThrow('Double entry debit and credit amounts must match exactly');
    });
  });

  describe('Immutability Schema Hooks', () => {
    it('should have pre-hooks registered on mutation operations', () => {
      // Confirm pre-hooks exist on LedgerEntry schema
      expect(LedgerEntry.schema.s.hooks._pres.has('updateOne')).toBe(true);
      expect(LedgerEntry.schema.s.hooks._pres.has('deleteOne')).toBe(true);
      expect(LedgerEntry.schema.s.hooks._pres.has('findOneAndUpdate')).toBe(true);
    });
  });
});
