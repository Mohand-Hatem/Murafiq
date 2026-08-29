import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import {
  REQUEST_STATUS,
  OFFER_STATUS,
  BOOKING_STATUS,
} from '../../src/common/constants/statuses.constant.js';

/**
 * The enums were widened to hold BOTH the legacy lowercase values and the new ones, and
 * then never narrowed — so `pending` and `OPEN` were simultaneously valid and 23
 * dual-casing checks were scattered through the services. These tests pin the enums
 * closed so that state cannot silently return.
 */
describe('Request / Offer / Booking status enums are narrowed', () => {
  it('Request accepts only the new lifecycle values', () => {
    const values = Request.schema.path('status').enumValues;
    expect(values.sort()).toEqual(Object.values(REQUEST_STATUS).sort());
  });

  it('Request rejects every legacy value', () => {
    const values = Request.schema.path('status').enumValues;
    for (const legacy of ['pending', 'offered', 'accepted', 'rejected', 'expired', 'cancelled']) {
      expect(values).not.toContain(legacy);
    }
  });

  it('Request has no OFFERED state — "has offers" is a count, not a status', () => {
    expect(Object.values(REQUEST_STATUS)).not.toContain('OFFERED');
    expect(Request.schema.path('offerCount')).toBeDefined();
    expect(Request.schema.path('firstOfferAt')).toBeDefined();
  });

  it('Request defaults to OPEN', () => {
    expect(Request.schema.path('status').defaultValue).toBe(REQUEST_STATUS.OPEN);
  });

  it('Offer accepts only the new lifecycle values', () => {
    const values = Offer.schema.path('status').enumValues;
    expect(values.sort()).toEqual(Object.values(OFFER_STATUS).sort());
  });

  it('Offer distinguishes CLOSED from REJECTED', () => {
    // "a sibling won" and "the client declined your bid" are different signals and must
    // not be collapsed — a stylist's acceptance rate depends on the distinction.
    const values = Offer.schema.path('status').enumValues;
    expect(values).toContain(OFFER_STATUS.CLOSED);
    expect(values).toContain(OFFER_STATUS.REJECTED);
  });

  it('Offer rejects every legacy value', () => {
    const values = Offer.schema.path('status').enumValues;
    for (const legacy of ['pending', 'accepted', 'rejected', 'expired', 'withdrawn']) {
      expect(values).not.toContain(legacy);
    }
  });

  it('Booking carries both no-show states in a single casing', () => {
    const values = Booking.schema.path('status').enumValues;
    expect(values).toContain(BOOKING_STATUS.NO_SHOW_STYLIST);
    expect(values).toContain(BOOKING_STATUS.NO_SHOW_CLIENT);
    expect(values).not.toContain('NO_SHOW_STYLIST');
    expect(values).not.toContain('NO_SHOW_CLIENT');
  });

  it('BOOKING_STATUS constant matches the model enum exactly', () => {
    const values = Booking.schema.path('status').enumValues;
    expect(Object.values(BOOKING_STATUS).sort()).toEqual(values.sort());
    // PENDING was dead drift: present on the constant, never valid on the model.
    expect(BOOKING_STATUS.PENDING).toBeUndefined();
  });
});

describe('Offer indexes', () => {
  it('carries no BLANKET unique {requestId, stylistId} constraint', () => {
    // The original blanket index made a second bid on the same request impossible for a
    // stylist's entire history. It has since been replaced by a PARTIAL index scoped to
    // live statuses, which still permits re-bidding after an earlier offer closes.
    const blanket = Offer.schema
      .indexes()
      .filter(([fields, opts]) => {
        const key = Object.keys(fields).join(',');
        return key === 'requestId,stylistId' && opts?.unique && !opts?.partialFilterExpression;
      });
    expect(blanket).toEqual([]);
  });

  it('caps LIVE offers at one per request, matching the confirmed rule', () => {
    // Confirmed business rule: at most ONE active offer per stylist per request, on top of
    // the subscription-based total (Free = 3 active). The index is partial so that a
    // REJECTED/CLOSED/WITHDRAWN/EXPIRED offer stops counting and the stylist may re-bid.
    // Behavioural coverage lives in tests/integration/offer.active-limit.test.js.
    const partial = Offer.schema
      .indexes()
      .find(([fields, opts]) =>
        Object.keys(fields).join(',') === 'requestId,stylistId' && opts?.partialFilterExpression
      );
    expect(partial).toBeDefined();
    expect(partial[1].partialFilterExpression.status.$in).toEqual(
      expect.arrayContaining(['PENDING', 'ACCEPTED'])
    );
  });
});

describe('Validation actually rejects legacy values at write time', () => {
  it('refuses a Request with a legacy status', async () => {
    const doc = new Request({
      clientId: '60f719b8f1a2c81234567890',
      visibility: 'broadcast',
      title: 'Legacy status probe',
      status: 'pending',
    });
    await expect(doc.validate()).rejects.toThrow(/status/i);
  });

  it('refuses an Offer with a legacy status', async () => {
    const doc = new Offer({
      requestId: '60f719b8f1a2c81234567891',
      stylistId: '60f719b8f1a2c81234567892',
      clientId: '60f719b8f1a2c81234567890',
      price: 300,
      duration: 60,
      status: 'pending',
    });
    await expect(doc.validate()).rejects.toThrow(/status/i);
  });
});
