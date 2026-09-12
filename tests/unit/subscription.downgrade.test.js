import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const fakeSession = {
  withTransaction: jest.fn(async (cb) => cb()),
  endSession: jest.fn(async () => {}),
};

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
// The immediate-grant path writes through replaceActivePlanCAS and snapshots the replaced
// plan first; only the SCHEDULED downgrade still goes through the plain updateById.
const mockReplaceActivePlanCAS = jest.fn();
const mockCreateHistoryEntry = jest.fn();

jest.unstable_mockModule('../../src/modules/subscriptions/plan.repository.js', () => ({
  default: { findByCode: mockFindByCode },
  findByCode: mockFindByCode,
}));
jest.unstable_mockModule('../../src/modules/subscriptions/subscription.repository.js', () => ({
  default: {
    findActiveByUserId: mockFindActiveByUserId,
    updateById: mockUpdateById,
    createSubscription: mockCreateSubscription,
    replaceActivePlanCAS: mockReplaceActivePlanCAS,
    createHistoryEntry: mockCreateHistoryEntry,
  },
  findActiveByUserId: mockFindActiveByUserId,
  updateById: mockUpdateById,
  createSubscription: mockCreateSubscription,
  replaceActivePlanCAS: mockReplaceActivePlanCAS,
  createHistoryEntry: mockCreateHistoryEntry,
}));
jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockPostEntry,
    postDoubleEntry: mockPostEntry,
    egpToPiastres: (n) => Math.round(n * 100),
  },
  postEntry: mockPostEntry,
  postDoubleEntry: mockPostEntry,
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
  fakeSession.withTransaction.mockImplementation(async (cb) => cb());
  fakeSession.endSession.mockResolvedValue();
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);
  mockUpdateById.mockImplementation((_id, data) => Promise.resolve({ _id, ...data }));
  mockReplaceActivePlanCAS.mockImplementation((_id, data) => Promise.resolve({ _id, ...data }));
  mockCreateHistoryEntry.mockResolvedValue({});
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

    // paid:true — an upgrade only ever reaches the grant path via handleSubscriptionWebhook,
    // after the provider HMAC has been verified and the order marked paid.
    const result = await subscribe(USER, 'client', { planCode: 'client.enterprise', paid: true });

    expect(result.scheduled).toBeUndefined();
    const [, update] = mockReplaceActivePlanCAS.mock.calls[0];
    expect(update.planCode).toBe('client.enterprise');
    expect(update.currentPeriodEnd).toBeInstanceOf(Date);
    // An upgrade is a PAID transition -- provenance must say so, not 'admin_grant'.
    expect(update.source).toBe('paid');
  });

  it('clears a queued downgrade when the user upgrades instead', async () => {
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1', planCode: 'client.basic', currentPeriodEnd: FUTURE, pendingPlanCode: 'client.free',
    });
    mockFindByCode.mockImplementation((code) =>
      Promise.resolve(code === 'client.enterprise' ? ENTERPRISE : BASIC)
    );

    await subscribe(USER, 'client', { planCode: 'client.enterprise', paid: true });

    const [, update] = mockReplaceActivePlanCAS.mock.calls[0];
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

    const result = await subscribe(USER, 'client', { planCode: 'client.basic', paid: true });

    expect(result.scheduled).toBeUndefined();
    const [, update] = mockReplaceActivePlanCAS.mock.calls[0];
    expect(update.planCode).toBe('client.basic');
  });

  it('REFUSES to grant a paid plan when payment has not been proven', async () => {
    // The whole point of the guard. /subscribe is authenticated but collects no money, so
    // reaching subscribe() without paid:true must never hand over a priced plan.
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1', planCode: 'client.free', currentPeriodEnd: null,
    });
    mockFindByCode.mockImplementation((code) =>
      Promise.resolve(code === 'client.enterprise' ? ENTERPRISE : BASIC)
    );

    await expect(
      subscribe(USER, 'client', { planCode: 'client.enterprise' })
    ).rejects.toMatchObject({ statusCode: 402 });

    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  it('still allows a DOWNGRADE to be scheduled without payment', async () => {
    // A downgrade grants nothing today, so the payment guard must not block it — otherwise
    // a paying subscriber would be trapped on the more expensive plan.
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1', planCode: 'client.enterprise', currentPeriodEnd: FUTURE,
    });
    mockFindByCode.mockImplementation((code) =>
      Promise.resolve(code === 'client.basic' ? BASIC : ENTERPRISE)
    );

    const result = await subscribe(USER, 'client', { planCode: 'client.basic' });

    expect(result.scheduled).toBe(true);
  });

  it('rejects a plan belonging to the other role', async () => {
    mockFindActiveByUserId.mockResolvedValue(null);
    mockFindByCode.mockResolvedValue({ ...PRO, role: 'stylist', code: 'stylist.pro' });

    await expect(subscribe(USER, 'client', { planCode: 'stylist.pro' })).rejects.toThrow(
      /only available for stylists/i
    );
  });
});
