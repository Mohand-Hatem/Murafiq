# Hardening 5 — Business Model Gaps

## Goal

Close the four gaps where the **product**, not the code, is incomplete. These are not bugs — the code
does what it was written to do. The problem is that what it was written to do doesn't add up to a
working marketplace.

> [!IMPORTANT]
> **This document opens with decisions, not steps.** Section A must be answered by the repo owner
> before any code in Section B is written. An AI assistant working through this file should present
> Section A's questions and **stop**, exactly as `02_PROJECT_RULES.md` requires — these are business
> rules that cannot be inferred from the codebase, and guessing them means rewriting the payment model
> a second time.

## Depends on

`HARDENING_02_CORRECTNESS.md` complete — specifically Step 4 (the refund ledger) and Step 9 (real
database tests). **Do not build payouts on a payment record that cannot represent a partial refund,
or on a test suite that has never touched a database.**

---

## Section A — Decisions required

> [!NOTE]
> **This section was written before `PHASE_10` and `PHASE_11` were re-read in full, and it over-asks.**
> Most of A1 and A2 is **already decided** in those phase docs — the payout rail (manual bank transfer
> / Vodafone Cash, admin-executed), the escrow release trigger (`SessionCompleted` + `Payment.paid`,
> excluding disputed bookings and open safety reports), and the dispute outcomes (`'completed'` |
> `'cancelled'` with an optional `refundPercentage` override).
>
> **See `HARDENING_07_PHASE_RECONCILIATION.md` Part 3 for the mapping.** Only four questions are
> genuinely open: **A1.4** (stylist bank/wallet details — no field exists anywhere), **A2.3** (the
> dispute filing window — nothing stops a dispute after payout), **A3**, and **A4**. Answer those four;
> treat the rest of this section as context for why they matter.

### A1. Payouts: how does money reach stylists?

**Current state.** Money flows in and stops. `PaymobProvider` collects from clients; `Payment` records
a `stylistPayoutAmount`; and then **nothing**. `src/modules/payouts/` is a `.gitkeep`.
`04_ROUTES.md` lists five payout routes and `01_PROJECT_STRUCTURE.md` §4 specifies the full module —
none of it exists.

Meanwhile `notification.listener.js:167` already tells stylists, on every completed session:

> "Session completed successfully. **Your earnings are now eligible for payout.**"

The platform is making a promise it has no mechanism to keep. **A marketplace that can collect but
not disburse is not a marketplace** — this is the single largest gap in the product.

**Questions to answer:**

1. **Payout rail.** Manual bank transfer with an admin marking batches paid (what `04_ROUTES.md`'s
   `mark-processing`/`mark-paid` routes imply)? Paymob's payout/disbursement product? Instapay?
   Something else? This determines whether `payout.provider.js` is a real integration or a
   record-keeping shell.
2. **Escrow release trigger.** Today `SESSION_COMPLETED` fires the moment **both** parties confirm
   (`booking.service.js:209`). Is that the release point, or is there a hold period (e.g. 48h) during
   which a dispute can still claw back? Given disputes are currently a dead-end state (A2), releasing
   immediately on mutual confirmation means a dispute filed afterwards has nothing left to recover.
3. **Payout cadence and minimum.** On demand, weekly batch, monthly? Minimum balance before payout?
4. **What the stylist must provide.** Bank details / wallet number — this is new PII on a user
   document that currently has no field for it, and it needs the same care as the KYC documents in
   `HARDENING_03` Step 1.
5. **Failed payouts.** Retry, or manual admin resolution?

### A2. Disputes: how does a disputed booking ever end?

**Current state.** `bookingService.fileDispute` (`booking.service.js:222`) sets
`status: 'disputed'` and emits `SESSION_DISPUTED`. **Nothing in the codebase can unset it.** There is
no resolve endpoint (`04_ROUTES.md` lists `PATCH /admin/bookings/:id/resolve-dispute` — not built), no
admin queue (`GET /admin/bookings/disputed` — not built), no arbitration logic, and no time limit on
filing. `'disputed'` is a terminal state that shouldn't be one.

For an **in-person** service, no-shows and "they didn't do what was agreed" are the *primary* real-world
failure modes. They currently have no handler.

Compounding problems already in the code:

- **The chat locks on completion** (`chat.service.js:271`), but disputes are filed *after* completion —
  so neither party can add evidence to the very thread an admin would read to arbitrate.
- **There's no time window on `fileDispute`.** A booking completed six months ago can be disputed
  today, after the stylist has (in a future world) been paid out.
- **A disputed booking can still be cancelled** via `cancelBooking`, which triggers a 100% refund
  because `cancelledBy` resolves to `'admin'` — an accidental back door around arbitration.

**Questions to answer:**

1. **Who arbitrates, and against what evidence?** Chat history, check-in geolocation
   (`booking.checkInLocation` is already captured), photos?
2. **What outcomes exist?** Full refund / partial refund / release to stylist / split? Each maps to a
   different write against the payment record built in `HARDENING_02` Step 4.
3. **Filing window.** How long after completion can a dispute be opened? (Suggest tying it to the
   escrow hold period from A1.2 — they're the same clock.)
4. **Does filing a dispute freeze the payout?** If yes, A1 and A2 must ship together.

### A3. Stylist cancellations are free and unlimited

**Current state.** `cancelBooking` (`booking.service.js:286`) applies the timing-based refund tiers
**only** when `cancelledBy === 'client'`. A stylist cancellation always refunds the client 100%, with
no penalty, no cancellation-rate tracking, and no cap. `PHASE_06_PAYMENTS.md` §3B documents this as
intended ("Stylist / Any time / no-show → Client 100%, Platform 0%").

The client-protection logic is right. What's missing is any **consequence** for the stylist. A stylist
can accept bookings to block a competitor's availability and cancel at zero cost, and the platform
absorbs the payment-processing fee every time. At scale this is an abuse vector, not a hypothetical.

**Questions:** Track a cancellation rate on `StylistProfile`? Suppress high-cancellation stylists in
search ranking? Suspend after N cancellations in a window? Charge a fee?

### A4. Daily caps are arbitrary magic numbers

**Current state.** Clients: 2 requests/day (`request.service.js:41`). Stylists: 5 offers/day
(`offer.service.js:45`). Both are hardcoded integers with no config, no per-user override, and no
documented rationale.

A client who wants to compare three stylists hits the wall on day one — on a marketplace whose entire
value proposition is choice. (Note the cap is also currently miscounted at the day boundary until
`HARDENING_02` Step 6 fixes the Cairo timezone bug.)

**Questions:** Are these anti-spam limits or deliberate scarcity? If anti-spam, they're too low and
should be config-driven with verified-user overrides. If scarcity, that belongs in the product doc,
not as an unexplained constant.

---

## Section B — Implementation (only after Section A is answered)

### 1. Payout ledger and module

Build `src/modules/payouts/` per `01_PROJECT_STRUCTURE.md` §4 and the five routes in `04_ROUTES.md`.

Design constraints that hold regardless of A1's answers:

- **Payouts must derive from `Payment` records, never recompute from `Booking.price`.** The payment
  record is the ledger; `HARDENING_02` Step 4 makes it able to represent partial refunds. A payout must
  read `stylistPayoutAmount` **after** any refund adjustment.
- **A refunded or partially-refunded payment must be excluded (or reduced) in payout aggregation.**
  This is the specific failure mode that makes ordering matter: aggregate before the ledger is correct
  and stylists get paid for refunded sessions.
- **Payout state must be idempotent.** `mark-processing` → `mark-paid` transitions need the same
  status guards `HARDENING_02` Step 5 adds to bookings, or a double-click pays twice.
- Use the provider pattern (`payout-provider.interface.js`) per architecture principle 5, even if the
  first implementation is "manual bank transfer, admin records the reference".
- Every transition writes to the audit log from `HARDENING_03` Step 5.

### 2. Dispute resolution flow

- `GET /admin/bookings/disputed` and `PATCH /admin/bookings/:id/resolve-dispute`.
- Add resolved states so `'disputed'` isn't terminal — e.g. `resolved_refunded`,
  `resolved_released`, `resolved_split`, on the booking or a dedicated `Dispute` document. Prefer a
  separate document: it keeps the dispute's evidence, resolution, and arbitrator on a record that
  survives, rather than overloading `booking.status`.
- Enforce the filing window from A2.3 in `fileDispute`.
- **Keep chat unlocked (or admin-reopenable) while a dispute is open** — fix the interaction with
  `chat.service.js:271` noted above.
- Block `cancelBooking` on a booking in `disputed` status, closing the back door.
- Resolution writes to the payment ledger and the audit log.

### 3. Stylist accountability (per A3)

- Track cancellations on `StylistProfile` (the model already carries `completedSessions`, so the
  counter pattern exists).
- Apply whatever consequence A3 selects.

### 4. Configurable caps (per A4)

- Move the `2` and `5` into `defaults.constant.js` or env config, with the rationale documented.
- Add overrides if A4 calls for them.

---

### Recorded Decisions (Approved & Implemented)

1. **A1.4 — Payout Credentials:** Stored on `StylistProfile.payoutAccount` with `method: 'bank_transfer' | 'vodafone_cash' | 'instapay'`, `accountHolderName`, `bankName`, `accountNumber`, and `walletPhone`. Self-managed via `GET /api/v1/payouts/account` and `PATCH /api/v1/payouts/account`.
2. **A2.3 — Dispute Window & Escrow Hold:** 48 hours post-session-completion (`DISPUTE_WINDOW_HOURS = 48`). Payout eligibility holds bookings for 48 hours before inclusion in disbursement batches.
3. **A3 — Stylist Cancellations:** Tracked on `StylistProfile.cancelledSessions`. Stylist-initiated cancellations increment the counter via event listener, raising operational warnings upon 3+ cancellations.
4. **A4 — Configurable Daily Caps:** Moved to `src/common/constants/defaults.constant.js` (`DEFAULT_CAPS: { CLIENT_DAILY_REQUESTS_UNVERIFIED: 2, CLIENT_DAILY_REQUESTS_VERIFIED: 5, STYLIST_DAILY_OFFERS: 10 }`).

---

## Definition of Done

- [x] Section A questions answered and the answers **recorded in this file** — not just decided in chat.
- [x] A stylist can receive money, end to end, through whatever rail A1 selected, with the payout recorded against specific `Payment` records.
- [x] Aggregating pending balances **excludes** refunded payments and **reduces** partially-refunded ones — verified by a test with a mix of paid, refunded, and partially-refunded bookings.
- [x] Marking a payout paid twice does not pay twice.
- [x] A disputed booking can reach a resolved state through `/admin`, and the resolution is reflected in the payment ledger.
- [x] A dispute filed outside the configured window is rejected.
- [x] `cancelBooking` refuses a booking in `disputed` status.
- [x] Chat is readable/writable by participants while a dispute is open.
- [x] Every payout and dispute transition appears in `GET /admin/audit-logs`.
- [x] The stylist-cancellation consequence from A3 is implemented, or explicitly deferred with a recorded reason.
- [x] Daily caps are config-driven and their rationale is documented.
- [x] `notification.listener.js:167`'s "eligible for payout" message is now true.
- [x] `npm run lint` and `npm test` exit 0.
