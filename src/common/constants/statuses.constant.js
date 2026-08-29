export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
  RESTRICTED: 'restricted',
  BLOCKED: 'blocked',
};

export const BOOKING_STATUS = {
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
  NO_SHOW_STYLIST: 'no-show-stylist',
  NO_SHOW_CLIENT: 'no-show-client',
};

// A booking in one of these states is finished and its money is already settled.
// Anything that moves money must check against this list, not an ad-hoc subset — the
// cancellation guards previously omitted the no-show states, which allowed a settled
// no-show to be cancelled afterwards and assess a SECOND penalty for the same incident
// (the {bookingId, reasonType} unique index permits it, since the reason differs).
export const BOOKING_TERMINAL_STATUSES = [
  'completed',
  'cancelled',
  'no-show-stylist',
  'no-show-client',
];

// Request lifecycle — see §F.1. Note there is deliberately no 'OFFERED' state:
// "has at least one offer" is a count (`Request.offerCount`), not a status.
export const REQUEST_STATUS = {
  OPEN: 'OPEN',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED',
  FULFILLED: 'FULFILLED',
  CANCELLED: 'CANCELLED',
  DECLINED: 'DECLINED',
};

// A request in these states can still receive offers and appears in the feed.
export const REQUEST_ACTIVE_STATUSES = [REQUEST_STATUS.OPEN];

// Offer lifecycle — see §F.2. CLOSED (a sibling won, or the request ended) is kept
// distinct from REJECTED (this client looked at this bid and declined it): they are
// very different signals on a stylist's dashboard and for acceptance-rate metrics.
export const OFFER_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED',
};

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
};

// Cancellation policy — see docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md §H.
// Boundary: exactly 24h00m falls in the CLIENT-FAVOURABLE tier (`diffHours >= EARLY_HOURS`).
export const CANCELLATION_POLICY = {
  EARLY_HOURS: 24,

  // Client cancels >= 24h before start: platform retains 3%, client refunded 97%.
  EARLY_CLIENT_REFUND_PERCENTAGE: 97,
  EARLY_PLATFORM_FEE_PERCENTAGE: 3,

  // Client cancels < 24h before start: platform retains 20%, client refunded 80%.
  // The stylist receives NOTHING on a client cancellation — a stylist who has not
  // travelled has not incurred the loss that the no-show policy compensates.
  LATE_CLIENT_REFUND_PERCENTAGE: 80,
  LATE_PLATFORM_FEE_PERCENTAGE: 20,

  // Stylist cancels: client is always refunded 100% and never bears the cost.
  // The stylist instead accrues a penalty debt, netted against a future payout.
  EARLY_STYLIST_PENALTY_PERCENTAGE: 3,
  LATE_STYLIST_PENALTY_PERCENTAGE: 20,

  // Backward-compatible aliases (pre-revision call sites).
  FULL_REFUND_HOURS: 24,
  PARTIAL_REFUND_PERCENTAGE: 80,
  PARTIAL_PLATFORM_FEE_PERCENTAGE: 20,
};

// No-show policy — see §H. Treated separately from cancellation: different money,
// different payout treatment, different reliability weight.
export const NO_SHOW_POLICY = {
  // A no-show cannot be filed until this long after the scheduled start.
  REPORT_GRACE_MINUTES: 30,
  // The accused party has this long to respond before it auto-resolves for the reporter.
  RESPONSE_WINDOW_HOURS: 2,

  // Stylist failed to attend: client made whole plus a goodwill coupon.
  STYLIST: {
    CLIENT_REFUND_PERCENTAGE: 100,
    PLATFORM_PERCENTAGE: 0,
    STYLIST_PERCENTAGE: 0,
    STYLIST_PENALTY_PERCENTAGE: 10,
    ISSUES_COUPON: true,
  },

  // Client failed to attend: the stylist travelled and lost the slot, so they are
  // partly compensated. Platform retains the same 20% as a late cancellation, so
  // Murafiq never earns more from a no-show than from a cancellation.
  CLIENT: {
    CLIENT_REFUND_PERCENTAGE: 60,
    PLATFORM_PERCENTAGE: 20,
    STYLIST_PERCENTAGE: 20,
    STYLIST_PENALTY_PERCENTAGE: 0,
    ISSUES_COUPON: false,
  },
};

// Coupon defaults — see §R item 17.
export const COUPON_POLICY = {
  NO_SHOW_DISCOUNT_PERCENTAGE: 10,
  // Absolute cap in EGP. Without it, platform exposure would scale with the most
  // valuable bookings, which is backwards.
  MAX_DISCOUNT_EGP: 150,
  MAX_ADMIN_DISCOUNT_EGP: 1000,
  EXPIRY_DAYS: 14,
  MIN_BOOKING_EGP: 0, // no minimum — bookings already carry a 100 EGP floor
};

export default {
  ACCOUNT_STATUS,
  BOOKING_STATUS,
  BOOKING_TERMINAL_STATUSES,
  REQUEST_STATUS,
  REQUEST_ACTIVE_STATUSES,
  OFFER_STATUS,
  PAYMENT_STATUS,
  CANCELLATION_POLICY,
  NO_SHOW_POLICY,
  COUPON_POLICY,
};
