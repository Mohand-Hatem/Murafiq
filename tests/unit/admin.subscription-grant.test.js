import { jest } from '@jest/globals';

/**
 * adminGrantSubscription() — the manual entitlement path.
 *
 * These assert the rules in isolation from HTTP. The single most important one is negative:
 * the grant must never reach the payment provider, the Payment/SubscriptionOrder repositories
 * or the ledger. A comp that writes balanced ledger rows books revenue nobody paid AND still
 * reconciles cleanly, so nothing would ever alert on it.
 */

const mockFindByCode = jest.fn();
const mockFindActiveByUserId = jest.fn();
const mockUpdateById = jest.fn();
const mockCreateSubscription = jest.fn();
const mockReplaceActivePlanCAS = jest.fn();
const mockCreateHistoryEntry = jest.fn();
const mockFindUserById = jest.fn();
const mockPostEntry = jest.fn();
const mockGetProvider = jest.fn();

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

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: { findById: mockFindUserById },
  findById: mockFindUserById,
}));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: { postEntry: mockPostEntry, egpToPiastres: (n) => Math.round(n * 100) },
  postEntry: mockPostEntry,
  egpToPiastres: (n) => Math.round(n * 100),
}));

jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  default: { getProvider: mockGetProvider },
  getProvider: mockGetProvider,
}));

const { adminGrantSubscription } = await import(
  '../../src/modules/subscriptions/subscription.service.js'
);

const ADMIN = '60f719b8f1a2c81234567800';
const USER = '60f719b8f1a2c81234567890';
const DAY_MS = 24 * 60 * 60 * 1000;

const CLIENT_PRO = {
  code: 'client.pro',
  name: 'Client Pro',
  role: 'client',
  tier: 'pro',
  priceEgp: 250,
  priceYearlyEgp: 2900,
};
const CLIENT_FREE = {
  code: 'client.free',
  name: 'Client Free',
  role: 'client',
  tier: 'free',
  priceEgp: 0,
  priceYearlyEgp: null,
};
const STYLIST_PRO = {
  code: 'stylist.pro',
  name: 'Stylist Pro',
  role: 'stylist',
  tier: 'pro',
  priceEgp: 400,
  priceYearlyEgp: 4500,
};

const clientUser = { _id: USER, role: 'client', name: 'Client' };
const stylistUser = { _id: USER, role: 'stylist', name: 'Stylist' };

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUserById.mockResolvedValue(clientUser);
  mockFindByCode.mockImplementation((code) => {
    if (code === 'client.pro') return Promise.resolve(CLIENT_PRO);
    if (code === 'client.free') return Promise.resolve(CLIENT_FREE);
    if (code === 'stylist.pro') return Promise.resolve(STYLIST_PRO);
    return Promise.resolve(null);
  });
  mockFindActiveByUserId.mockResolvedValue(null);
  mockCreateSubscription.mockImplementation((data) => Promise.resolve({ _id: 'sub1', ...data }));
  mockReplaceActivePlanCAS.mockImplementation((id, data) => Promise.resolve({ _id: id, ...data }));
  mockCreateHistoryEntry.mockResolvedValue({});
  mockGetProvider.mockImplementation(() => {
    throw new Error('getProvider() must never be called by an admin grant');
  });
});

describe('adminGrantSubscription() — no payment is involved', () => {
  it('never touches the payment provider or the ledger', async () => {
    await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.pro',
      reason: 'comp',
    });

    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockPostEntry).not.toHaveBeenCalled();
  });

  it('marks provenance as admin_grant, not paid', async () => {
    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.pro',
      reason: 'comp',
    });

    expect(subscription.source).toBe('admin_grant');
    expect(subscription.grantedBy).toBe(ADMIN);
    expect(subscription.grantReason).toBe('comp');
  });
});

describe('adminGrantSubscription() — target and plan validation', () => {
  it('404s on an unknown target user', async () => {
    mockFindUserById.mockResolvedValue(null);

    await expect(
      adminGrantSubscription(USER, ADMIN, { planCode: 'client.pro', reason: 'x' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s on an unknown plan code', async () => {
    await expect(
      adminGrantSubscription(USER, ADMIN, { planCode: 'client.nope', reason: 'x' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('still names the replacement for a retired .yearly plan code', async () => {
    await expect(
      adminGrantSubscription(USER, ADMIN, { planCode: 'client.pro.yearly', reason: 'x' })
    ).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringMatching(/billingCycle/),
    });
  });

  it('400s when the plan belongs to the other role', async () => {
    // A client on a stylist plan would resolve a stylist entitlement map — silently wrong
    // limits rather than a visible error.
    await expect(
      adminGrantSubscription(USER, ADMIN, { planCode: 'stylist.pro', reason: 'x' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('400s when the target is an admin or operator account', async () => {
    for (const role of ['admin', 'operator']) {
      mockFindUserById.mockResolvedValue({ _id: USER, role });

      await expect(
        adminGrantSubscription(USER, ADMIN, { planCode: 'client.pro', reason: 'x' })
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('grants a stylist plan to a stylist', async () => {
    mockFindUserById.mockResolvedValue(stylistUser);

    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'stylist.pro',
      reason: 'incentive',
    });

    expect(subscription.planCode).toBe('stylist.pro');
    expect(subscription.role).toBe('stylist');
  });

  it('400s for a yearly cycle on a plan with no yearly price, when no duration is given', async () => {
    await expect(
      adminGrantSubscription(USER, ADMIN, {
        planCode: 'client.free',
        billingCycle: 'yearly',
        reason: 'x',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('adminGrantSubscription() — period arithmetic', () => {
  it('uses durationDays when supplied', async () => {
    const before = Date.now();
    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.pro',
      durationDays: 90,
      reason: 'x',
    });

    expect(
      Math.abs(subscription.currentPeriodEnd.getTime() - (before + 90 * DAY_MS))
    ).toBeLessThan(5000);
  });

  it("falls back to the plan's monthly cycle length", async () => {
    const before = Date.now();
    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.pro',
      reason: 'x',
    });

    expect(
      Math.abs(subscription.currentPeriodEnd.getTime() - (before + 30 * DAY_MS))
    ).toBeLessThan(5000);
  });

  it("uses the plan's yearly cycle length for billingCycle=yearly", async () => {
    const before = Date.now();
    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.pro',
      billingCycle: 'yearly',
      reason: 'x',
    });

    expect(
      Math.abs(subscription.currentPeriodEnd.getTime() - (before + 365 * DAY_MS))
    ).toBeLessThan(5000);
  });

  it('forces currentPeriodEnd to null for a free tier, even with an explicit duration', async () => {
    // null is the load-bearing "never expires" signal findExpiringSubscriptions filters on.
    // A dated free row would enter the expiry sweep with nothing to downgrade it to.
    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.free',
      durationDays: 90,
      reason: 'revoke',
    });

    expect(subscription.currentPeriodEnd).toBeNull();
  });

  it('REPLACES the remaining period rather than stacking onto it', async () => {
    const farFuture = new Date(Date.now() + 300 * DAY_MS);
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1',
      planCode: 'client.pro',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: farFuture,
      source: 'paid',
    });

    const before = Date.now();
    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.pro',
      durationDays: 10,
      reason: 'shorten',
    });

    expect(
      Math.abs(subscription.currentPeriodEnd.getTime() - (before + 10 * DAY_MS))
    ).toBeLessThan(5000);
  });
});

describe('adminGrantSubscription() — downgrade is immediate, never scheduled', () => {
  it('applies a move to a cheaper plan now instead of queueing pendingPlanCode', async () => {
    // The customer-facing scheduled-downgrade rule is a courtesy to someone who paid. An
    // admin action is corrective and must land immediately.
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1',
      planCode: 'client.pro',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS),
      source: 'paid',
    });

    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.free',
      reason: 'chargeback',
    });

    expect(subscription.planCode).toBe('client.free');
    expect(subscription.pendingPlanCode).toBeNull();
    expect(subscription.currentPeriodEnd).toBeNull();
  });

  it('clears a queued customer downgrade', async () => {
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1',
      planCode: 'client.pro',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS),
      pendingPlanCode: 'client.free',
      pendingBillingCycle: 'monthly',
      source: 'paid',
    });

    const { subscription } = await adminGrantSubscription(USER, ADMIN, {
      planCode: 'client.pro',
      durationDays: 60,
      reason: 'extend',
    });

    expect(subscription.pendingPlanCode).toBeNull();
    expect(subscription.pendingBillingCycle).toBeNull();
  });
});

describe('adminGrantSubscription() — history and concurrency', () => {
  it('snapshots the replaced plan before overwriting it', async () => {
    const periodEnd = new Date(Date.now() + 20 * DAY_MS);
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1',
      planCode: 'client.pro',
      billingCycle: 'monthly',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      source: 'paid',
    });

    await adminGrantSubscription(USER, ADMIN, { planCode: 'client.free', reason: 'revoke' });

    const [entry] = mockCreateHistoryEntry.mock.calls[0];
    expect(entry.changeType).toBe('admin_grant');
    expect(entry.previousPlanCode).toBe('client.pro');
    expect(entry.previousSource).toBe('paid');
    expect(entry.previousPeriodEnd).toBe(periodEnd);
    expect(entry.newPlanCode).toBe('client.free');
    expect(entry.newSource).toBe('admin_grant');
    expect(entry.changedBy).toBe(ADMIN);
    expect(entry.changeReason).toBe('revoke');
  });

  it('records a grant to a user who had no subscription, with a null previous plan', async () => {
    await adminGrantSubscription(USER, ADMIN, { planCode: 'client.pro', reason: 'new account' });

    const [entry] = mockCreateHistoryEntry.mock.calls[0];
    expect(entry.previousPlanCode).toBeNull();
    expect(entry.newPlanCode).toBe('client.pro');
  });

  it('writes through the CAS, not a bare updateById', async () => {
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1',
      planCode: 'client.free',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
    });

    await adminGrantSubscription(USER, ADMIN, { planCode: 'client.pro', reason: 'x' });

    expect(mockReplaceActivePlanCAS).toHaveBeenCalledTimes(1);
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  it('409s rather than writing a second active row when the CAS loses', async () => {
    mockFindActiveByUserId.mockResolvedValue({
      _id: 'sub1',
      planCode: 'client.free',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
    });
    // The row stopped being 'active' between the read and the write.
    mockReplaceActivePlanCAS.mockResolvedValue(null);

    await expect(
      adminGrantSubscription(USER, ADMIN, { planCode: 'client.pro', reason: 'x' })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockCreateSubscription).not.toHaveBeenCalled();
  });
});
