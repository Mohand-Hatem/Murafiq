import fs from 'fs';
import LedgerEntry from '../../src/modules/ledger/ledger-entry.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import { NOTIFICATION_TYPES } from '../../src/modules/notifications/notification.model.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import { BOOKING_TERMINAL_STATUSES } from '../../src/common/constants/statuses.constant.js';

/**
 * Cross-module coherence guards.
 *
 * Every check here corresponds to a real defect found during the Phases 0–13 audit. They
 * share a failure mode: a string used in one module that another module's schema enum
 * rejects. Because the write paths are wrapped in try/catch for resilience, the rejection
 * is SILENT — no error surfaces, no test fails, and the record simply never exists.
 *
 * Enum drift is invisible at runtime, so it has to be caught structurally.
 */

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
};
const SRC_FILES = walk('src');
const readAll = () => SRC_FILES.map((f) => ({ f, txt: fs.readFileSync(f, 'utf8') }));

describe('Ledger entryType values used in code exist in the schema enum', () => {
  it('every entryType literal is a valid enum value', () => {
    const allowed = LedgerEntry.schema.path('entryType').enumValues;
    const offenders = [];
    for (const { f, txt } of readAll()) {
      for (const m of txt.matchAll(/entryType:\s*'([A-Z_]+)'/g)) {
        if (!allowed.includes(m[1])) offenders.push(`${m[1]} in ${f}`);
      }
    }
    // A miss here means money moves without a ledger record — the exact failure that hid
    // PAYMENT, STYLIST_PAYOUT and PENALTY_SETTLED. Worse, paired debit/credit writes share
    // one try block, so the first rejection suppresses its partner and the reconciliation
    // job still sees a balanced (0 = 0) booking and never alerts.
    expect(offenders).toEqual([]);
  });

  it('covers both sides of the escrow flow', () => {
    const allowed = LedgerEntry.schema.path('entryType').enumValues;
    for (const t of ['PAYMENT', 'ESCROW_HOLD', 'ESCROW_RELEASE', 'REFUND']) {
      expect(allowed).toContain(t);
    }
  });

  it('covers penalty assessment and settlement as distinct types', () => {
    const allowed = LedgerEntry.schema.path('entryType').enumValues;
    expect(allowed).toContain('PENALTY_ASSESSMENT');
    expect(allowed).toContain('PENALTY_SETTLEMENT');
    expect(allowed).toContain('PAYOUT_DISBURSEMENT');
  });
});

describe('Notification types used in code exist in the schema enum', () => {
  it('every notification type literal is valid', () => {
    const offenders = [];
    for (const { f, txt } of readAll()) {
      if (!f.includes('listener') && !f.includes('notification.service')) continue;
      for (const m of txt.matchAll(/type:\s*'([a-z_]+)',\s*\n\s*title:/g)) {
        if (!NOTIFICATION_TYPES.includes(m[1])) offenders.push(`${m[1]} in ${f}`);
      }
    }
    // 'dispute' was used by the dispute listener but absent from the enum, so every
    // dispute notification failed validation and no party was ever told.
    expect(offenders).toEqual([]);
  });
});

describe('Money-affecting events are audit-logged', () => {
  it('every event that moves money or ends a booking has an audit listener', () => {
    const audit = fs.readFileSync('src/modules/audit-log/audit-log.listener.js', 'utf8');
    // AGENTS.md: audit logging is event-bus-driven only, and any new money/admin-affecting
    // event must be added to the map rather than bypassed.
    const mustAudit = [
      'BOOKING_CANCELLED',
      'NO_SHOW_REPORTED',
      'NO_SHOW_RESOLVED',
      'PAYMENT_SUCCEEDED',
      'PAYMENT_FAILED',
      'PAYMENT_REFUNDED',
      'PAYOUT_PAID',
      'DISPUTE_RESOLVED',
    ];
    const missing = mustAudit.filter((k) => !audit.includes(`EVENTS.${k}`));
    expect(missing).toEqual([]);
    // Guard against a rename silently emptying the list above.
    mustAudit.forEach((k) => expect(EVENTS[k]).toBeDefined());
  });
});

describe('Booking terminal states are treated consistently', () => {
  it('lists every settled state, including both no-show outcomes', () => {
    expect(BOOKING_TERMINAL_STATUSES).toEqual(
      expect.arrayContaining(['completed', 'cancelled', 'no-show-stylist', 'no-show-client'])
    );
  });

  it('every terminal status is a valid booking status', () => {
    const valid = Booking.schema.path('status').enumValues;
    BOOKING_TERMINAL_STATUSES.forEach((s) => expect(valid).toContain(s));
  });

  it('cancelBooking guards against the shared list, not an ad-hoc subset', () => {
    const svc = fs.readFileSync('src/modules/bookings/booking.service.js', 'utf8');
    // Cancelling an already-settled no-show would assess a SECOND penalty for one
    // incident — the {bookingId, reasonType} unique index permits it because the reason
    // differs (NO_SHOW vs LATE_CANCEL) — and would overwrite the no-show record.
    expect(svc).toContain('BOOKING_TERMINAL_STATUSES.includes(booking.status)');
    expect(svc).toContain('BOOKING_TERMINAL_STATUSES.includes(currentBooking.status)');
  });
});

describe('Payout eligibility excludes frozen bookings', () => {
  it('filters isFrozen in the repository query', () => {
    const repo = fs.readFileSync('src/modules/bookings/booking.repository.js', 'utf8');
    // A frozen booking deliberately keeps status 'completed' so an admin can still resolve
    // it, so a status-only filter would pay out money that is meant to be held.
    expect(repo).toMatch(/isFrozen:\s*\{\s*\$ne:\s*true\s*\}/);
  });

  it('uses one shared predicate for both eligibility queries', () => {
    const repo = fs.readFileSync('src/modules/bookings/booking.repository.js', 'utf8');
    // If the per-stylist and all-stylists queries diverge, the admin dashboard shows a
    // balance the batch job will not actually pay.
    expect(repo).toContain('PAYOUT_ELIGIBILITY');
  });
});

describe('Quota is not consumed before content is accepted', () => {
  it.each([
    ['requests', 'src/modules/requests/request.service.js', 'requests.daily'],
    ['offers', 'src/modules/offers/offer.service.js', 'offers.daily'],
  ])('%s: moderation scan runs before entitlement consume', (_label, file, metric) => {
    const txt = fs.readFileSync(file, 'utf8');
    const scanAt = txt.indexOf('scanAndEnforce');
    const consumeAt = txt.indexOf(`consume(`);
    expect(scanAt).toBeGreaterThan(-1);
    expect(consumeAt).toBeGreaterThan(-1);
    // Consuming first burns a Free client's ONE daily request on a message that was
    // blocked and never created. The moderation strike is recorded either way, so abuse
    // is still deterred without the quota burn.
    expect(scanAt).toBeLessThan(consumeAt);
    expect(txt).toContain(metric);
  });
});

describe('Cron jobs are safe under the documented deployment model', () => {
  const CRONS = fs.readdirSync('src/jobs').filter((f) => f.endsWith('.cron.js'));

  it('there is at least one scheduled job', () => {
    expect(CRONS.length).toBeGreaterThan(0);
  });

  it.each(CRONS)('%s registers idempotently and skips in tests', (file) => {
    const txt = fs.readFileSync(`src/jobs/${file}`, 'utf8');
    // Re-registering on a hot reload would double every sweep; running on a timer during
    // tests makes them non-deterministic.
    expect(txt).toMatch(/if\s*\(registered\)\s*return/);
    expect(txt).toContain("env.NODE_ENV === 'test'");
  });

  it('PM2 still pins a single instance, which the crons depend on', () => {
    const eco = fs.readFileSync('ecosystem.config.cjs', 'utf8');
    // These sweeps are in-process node-cron with no distributed lock. Scaling to cluster
    // mode would run every sweep once per instance. Phase 14's BullMQ migration is what
    // eventually lifts this constraint — until then it is load-bearing.
    expect(eco).toMatch(/instances:\s*1/);
    expect(eco).toMatch(/exec_mode:\s*'fork'/);
  });
});
