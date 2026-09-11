import '../../src/common/globals.js';
import { assertBookingParticipant } from '../../src/common/authz/assertParticipant.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';

const booking = { clientId: 'c1', stylistId: 's1' };

describe('assertBookingParticipant', () => {
  it('accepts the client and reports which party they are', () => {
    const r = assertBookingParticipant({ _id: 'c1', role: ROLES.CLIENT }, booking);
    expect(r).toMatchObject({ userId: 'c1', isClient: true, isStylist: false, isAdmin: false });
  });

  it('accepts the stylist', () => {
    const r = assertBookingParticipant({ id: 's1', role: ROLES.STYLIST }, booking);
    expect(r).toMatchObject({ isStylist: true, isClient: false });
  });

  it('accepts an admin ONLY when allowAdmin is passed explicitly', () => {
    const r = assertBookingParticipant({ _id: 'a1', role: ROLES.ADMIN }, booking, { allowAdmin: true });
    expect(r.isAdmin).toBe(true);
  });

  it('FAILS CLOSED: rejects an admin when the option is omitted', () => {
    // The security property of this helper. If this test ever needs changing, stop.
    expect(() => assertBookingParticipant({ _id: 'a1', role: ROLES.ADMIN }, booking))
      .toThrow('Forbidden');
  });

  it('rejects an admin when allowAdmin is explicitly false', () => {
    expect(() => assertBookingParticipant({ _id: 'a1', role: ROLES.ADMIN }, booking, { allowAdmin: false }))
      .toThrow('Forbidden');
  });

  it('rejects an unrelated user', () => {
    expect(() => assertBookingParticipant({ _id: 'x9', role: ROLES.CLIENT }, booking))
      .toThrow('Forbidden');
  });

  it('unwraps populated clientId/stylistId documents', () => {
    const populated = { clientId: { _id: 'c1' }, stylistId: { _id: 's1' } };
    expect(assertBookingParticipant({ _id: 'c1', role: ROLES.CLIENT }, populated).isClient).toBe(true);
  });

  it('rejects when user is null or undefined', () => {
    expect(() => assertBookingParticipant(null, booking)).toThrow('Forbidden');
    expect(() => assertBookingParticipant(undefined, booking)).toThrow('Forbidden');
  });

  it('rejects when booking is null or missing clientId/stylistId', () => {
    expect(() => assertBookingParticipant({ _id: 'c1', role: ROLES.CLIENT }, null)).toThrow('Forbidden');
    expect(() => assertBookingParticipant({ _id: 'c1', role: ROLES.CLIENT }, {})).toThrow('Forbidden');
    expect(() => assertBookingParticipant({ _id: 'c1', role: ROLES.CLIENT }, { clientId: null, stylistId: null })).toThrow('Forbidden');
  });
});
