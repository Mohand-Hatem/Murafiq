import { BOOKING_STATUS } from '../../common/constants/statuses.constant.js';

/**
 * The single definition of which booking status transitions are legal.
 *
 * Transcribed from the nine status writers that existed before this file, NOT redesigned:
 * every edge below is one a writer already performed, and no edge a writer performed is
 * missing. See docs/archive/simplification/SIMPLIFICATION_IMPLEMENTATION_PLAN_2026_09.md §E.1 for the writer-by-
 * writer derivation, and §D.5 BK1 for why nine divergent copies produced audit findings
 * X4 (admin resurrects any booking), X9 (terminal overwrite) and X10 (in-progress
 * cancellable) independently of one another.
 *
 * Two edges are load-bearing and must not be "tidied":
 *  - IN_PROGRESS deliberately does NOT reach CANCELLED (X10). A client who could cancel a
 *    session already checked into could let the stylist finish the job and then collect an
 *    80% refund, and the stylist's only recourse (fileDispute) does not accept 'cancelled'.
 *  - DISPUTED reaches CONFIRMED/IN_PROGRESS ONLY via adminResolveNoShow dismissal, which
 *    restores noShowDetails.contestedFromStatus -- never a hardcoded value (X4).
 */
export const BOOKING_TRANSITIONS = Object.freeze({
  [BOOKING_STATUS.CONFIRMED]: Object.freeze([
    BOOKING_STATUS.IN_PROGRESS,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.DISPUTED,
    BOOKING_STATUS.NO_SHOW_STYLIST,
    BOOKING_STATUS.NO_SHOW_CLIENT,
  ]),
  [BOOKING_STATUS.IN_PROGRESS]: Object.freeze([
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.DISPUTED,
    BOOKING_STATUS.NO_SHOW_STYLIST,
    BOOKING_STATUS.NO_SHOW_CLIENT,
  ]),
  [BOOKING_STATUS.COMPLETED]: Object.freeze([BOOKING_STATUS.DISPUTED]),
  [BOOKING_STATUS.DISPUTED]: Object.freeze([
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.IN_PROGRESS,
  ]),
  [BOOKING_STATUS.CANCELLED]: Object.freeze([]),
  [BOOKING_STATUS.NO_SHOW_STYLIST]: Object.freeze([]),
  [BOOKING_STATUS.NO_SHOW_CLIENT]: Object.freeze([]),
});

/** Every status a booking may legally be in immediately before reaching `toStatus`. */
export const legalFromStatesFor = (toStatus) =>
  Object.entries(BOOKING_TRANSITIONS)
    .filter(([, targets]) => targets.includes(toStatus))
    .map(([from]) => from);

export const isLegalTransition = (fromStatus, toStatus) =>
  Boolean(BOOKING_TRANSITIONS[fromStatus]?.includes(toStatus));

export default { BOOKING_TRANSITIONS, legalFromStatesFor, isLegalTransition };
