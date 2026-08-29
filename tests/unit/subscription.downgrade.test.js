import { jest } from '@jest/globals';

/**
 * Deferred downgrades (§E.5).
 *
 * `subscribe()` previously applied every plan change immediately, including downgrades —
 * which reset `currentPeriodStart`/`currentPeriodEnd` and stripped entitlements the user
 * had already paid for. A client who bought a month of Pro on day 1 and moved to Basic on
 * day 2 silently lost 28 paid days.
 */

const mockFindByCode = jest.fn();
const mockFindActiveByUserId = jest.fn();
const mockUpdateById = jest.fn();
const mockCreateSubscription = jest.fn();
const mockPostEntry = jest.fn();

jest.unstable_mockModule('../../src/modules/subscriptions/plan.repository.js', () => ({
  default: { findByCode: mockFindByCode },
  findByCode: mockFindByCode,
}));
jest.unstable_mockModule('../../src/modules/subscriptions/subscription.repository.js', () => ({
  default: {
    findActiveByUserId: mockFindActiveByUserId,
    updateById: mockUpdateById,
    createSubscription: mockCreateSubscription,
  },
  findActiveByUserId: mockFindActiveByUserId,
  updateById: mockUpdateById,
  createSubscription: mockCreateSubscription,
}));
jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: { postEntry: mockPostEntry, egpToPiastres: (n) => Math.round(n * 100) },
  postEntry: mockPostEntry,
  egpToPiastres: (n) => Math.round(n * 100),
}));

const { subscribe } = await import('../../src/modules/subscriptions/subscription.service.js');

const USER = '60f719b8f1a2c81234567890';
const FUTURE = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);

const PRO = { code: 'client.pro', name: 'Client Pro', role: 'client', tier: 'pro', priceEgp: 250 };
const BASIC = { code: 'client.basic', name: 'Client Basic', role: 'client', tier: 'basic', priceEgp: 50 };
const ENTERPRISE = {
  code: 'client.enterprise', name: 'Client Enterprise', role: 'client', tier: 'enterprise', priceEgp: 500,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateById.mockImplementation((_id, data) => Promise.resolve({ _id, ...data }));
});

describe('subscribe() — downgrade handling', () => {
  it('SCHEDULES a downgrade instead of applying it, preserving the paid period', async () => {
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1', planCode: 'client.pro', currentPeriodEnd: FUTURE,
    });
    mockFindByCode.mockImplementation((code) =>
      Promise.resolve(code === 'client.basic' ? BASIC : PRO)
    );

    const result = await subscribe(USER, 'client', { planCode: 'client.basic' });

    expect(result.scheduled).toBe(true);
    expect(result.effectiveAt).toEqual(FUTURE);

    const [, update] = mockUpdateById.mock.calls[0];
    expect(update.pendingPlanCode).toBe('client.basic');
    // The live plan and its period must be untouched — that is the whole point.
    expect(update.planCode).toBeUndefined();
    expect(update.currentPeriodEnd).toBeUndefined();
    expect(update.currentPeriodStart).toBeUndefined();
  });

  it('applies an UPGRADE immediately', async () => {
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1', planCode: 'client.basic', currentPeriodEnd: FUTURE,
    });
    mockFindByCode.mockImplementation((code) =>
      Promise.resolve(code === 'client.enterprise' ? ENTERPRISE : BASIC)
    );

    const result = await subscribe(USER, 'client', { planCode: 'client.enterprise' });

    expect(result.scheduled).toBeUndefined();
    const [, update] = mockUpdateById.mock.calls[0];
    expect(update.planCode).toBe('client.enterprise');
    expect(update.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it('clears a queued downgrade when the user upgrades instead', async () => {
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1', planCode: 'client.basic', currentPeriodEnd: FUTURE, pendingPlanCode: 'client.free',
    });
    mockFindByCode.mockImplementation((code) =>
      Promise.resolve(code === 'client.enterprise' ? ENTERPRISE : BASIC)
    );

    await subscribe(USER, 'client', { planCode: 'client.enterprise' });

    const [, update] = mockUpdateById.mock.calls[0];
    expect(update.pendingPlanCode).toBeNull();
    expect(update.pendingBillingCycle).toBeNull();
  });

  it('applies immediately when there is no paid period left to protect', async () => {
    // A Free user has currentPeriodEnd === null — nothing has been paid for, so deferring
    // would just block them from moving between free plans.
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1', planCode: 'client.pro', currentPeriodEnd: null,
    });
    mockFindByCode.mockImplementation((code) =>
      Promise.resolve(code === 'client.basic' ? BASIC : PRO)
    );

    const result = await subscribe(USER, 'client', { planCode: 'client.basic' });

    expect(result.scheduled).toBeUndefined();
    const [, update] = mockUpdateById.mock.calls[0];
    expect(update.planCode).toBe('client.basic');
  });

  it('rejects a plan belonging to the other role', async () => {
    mockFindActiveByUserId.mockResolvedValue(null);
    mockFindByCode.mockResolvedValue({ ...PRO, role: 'stylist', code: 'stylist.pro' });

    await expect(subscribe(USER, 'client', { planCode: 'stylist.pro' })).rejects.toThrow(
      /only available for stylists/i
    );
  });
});
