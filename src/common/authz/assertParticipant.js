import { ROLES } from '../constants/roles.constant.js';

const idOf = (v) => (v && typeof v === 'object' ? (v._id ?? v.id ?? v) : v)?.toString();

/**
 * The single booking participant/ownership check.
 *
 * Replaces ~20 verbatim copies that had drifted apart: two of them (checkIn,
 * confirmCompletion) excluded admins while six others included them, and four compared
 * against the STRING 'admin' rather than ROLES.ADMIN. llowAdmin is stated per call site
 * -- the point is not to standardise the policy (that would be a product change), it is to
 * make each site's existing policy greppable instead of implied by a copy-paste.
 *
 * llowAdmin DEFAULTS TO FALSE, deliberately. A privilege-granting option must fail
 * closed: a caller who forgets it gets the strictest behaviour (participants only) and a
 * visible 403, not a silent admin bypass on a booking route. The six call sites that DO
 * grant admin access pass { allowAdmin: true } explicitly, which is exactly the audit
 * trail this helper exists to create. Never change this default to true "for convenience" --
 * the whole authorization bug class this replaces came from an implied policy.
 *
 * Throws the same 403 'Forbidden' the copies threw, so no API response changes.
 *
 * @param {{_id?: any, id?: any, role?: string}} user
 * @param {{clientId: any, stylistId: any}} booking  populated or raw ids both work
 * @param {{allowAdmin?: boolean}} [opts]  allowAdmin defaults to FALSE (fail closed)
 * @returns {{userId: string, clientId: string, stylistId: string,
 *            isClient: boolean, isStylist: boolean, isAdmin: boolean}}
 */
export const assertBookingParticipant = (user, booking, { allowAdmin = false } = {}) => {
  const userId = idOf(user?._id ?? user?.id ?? user);
  const clientId = idOf(booking?.clientId);
  const stylistId = idOf(booking?.stylistId);

  const isClient = Boolean(userId) && userId === clientId;
  const isStylist = Boolean(userId) && userId === stylistId;
  const isAdmin = user?.role === ROLES.ADMIN;

  if (!isClient && !isStylist && !(allowAdmin && isAdmin)) {
    throw new ApiError(403, 'Forbidden');
  }

  return { userId, clientId, stylistId, isClient, isStylist, isAdmin };
};

export default assertBookingParticipant;
