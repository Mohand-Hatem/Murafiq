# Safety Module — Undecided: Build It, or Remove `isFrozen`

## Status
DEFERRED — NOT FIXED (decision not yet made)

## Priority
MEDIUM

## Why It Was Deferred
This is not a bug to patch — it is an unresolved **product/architecture
decision** left over from Phase 11 (`PHASE_11_SAFETY_PAYOUTS.md`), which shipped
only its payouts half. The pre-Phase-15 fix pass corrected concrete, verified
bugs in code that exists; it deliberately did not attempt to resolve an
open-ended "should we build this feature or not" question, which is squarely a
business decision, not an engineering fix.

## Current Problem
`Booking.isFrozen` exists on the schema, is indexed, and is actively **read** by
the payout-eligibility filter — but nothing in the codebase ever **writes** it
to `true`. There is no safety module: `src/modules/safety/` contains only a
`.gitkeep` file.

```js
// booking.model.js
isFrozen: { type: Boolean, default: false },
...
bookingSchema.index({ isFrozen: 1, payoutStatus: 1 });

// booking.repository.js — PAYOUT_ELIGIBILITY filter
// `isFrozen` must be excluded here, not only relied on via `status`. A booking frozen by
// the moderation enforcement chain keeps status 'completed' by design...
isFrozen: { $ne: true },
```

The comment describes an enforcement chain ("a booking frozen by the moderation
enforcement chain") that does not exist in the shipped code. `grep -rn
"isFrozen" src/` confirms exactly three references: the schema field default,
the compound index, and this one read-side exclusion — no writer anywhere.

## Evidence
- `src/modules/bookings/booking.model.js` — `isFrozen` field definition and its
  compound index.
- `src/modules/bookings/booking.repository.js` — the `PAYOUT_ELIGIBILITY`
  filter's `isFrozen: { $ne: true }` clause and its accompanying comment.
- `src/modules/safety/.gitkeep` — the entire contents of the safety module
  directory.
- `docs/PHASE_11_SAFETY_PAYOUTS.md` — the phase document that specifies both
  halves (safety + payouts); only payouts was built.

## Risk / Impact
No active bug: `isFrozen` defaults to `false` and is never set to `true`
anywhere, so its presence in the `PAYOUT_ELIGIBILITY` filter is currently a
no-op (it excludes nothing, because nothing is ever frozen). The risk is
entirely about the **gap between what the code implies and what actually
happens**: the inline comment and the field's existence both suggest a
safety-report-driven payout freeze exists and works, when it does not. Anyone
relying on that comment (a future engineer, an auditor, an incident responder)
would be wrong to assume a disputed or reported booking's payout is
automatically held — it is not, unless the *existing* dispute-status mechanism
(`status: 'disputed'`, which is a genuinely enforced payout-eligibility
exclusion via the `status` filter itself) already covers the scenario in
question.

## Expected Future Fix
This requires a decision, not a default direction — document it here as the
two real options rather than presupposing the answer:

**Option A — Build the safety module.** Implement whatever the actual
business requirement is (SOS/check-in style safety reporting, as
`PHASE_11_SAFETY_PAYOUTS.md` originally scoped, or a narrower version of it),
with a real write path that sets `isFrozen: true` on a booking when a safety
report is filed against it, and a corresponding admin flow to review and
unfreeze. This makes the existing schema field, index, and payout-eligibility
exclusion actually meaningful.

**Option B — Remove the unused field and its references.** If the business
no longer requires a standalone safety-reporting workflow separate from the
existing dispute mechanism, remove `isFrozen` from the schema, drop its index,
remove the exclusion clause from `PAYOUT_ELIGIBILITY`, and correct the
misleading comment — so the codebase does not imply protection that isn't
there.

Either resolution is acceptable; leaving the current half-state (field exists,
comment implies a workflow, no workflow exists) is the one option that should
not persist into production.

## Dependencies
- This is the deferred half of Phase 11 (`PHASE_11_SAFETY_PAYOUTS.md`). Any
  decision here should be made with that document in hand, since it already
  specifies what the safety half was originally meant to cover.
- Does not block Phase 15 or Phase 16 technically, but the misleading comment
  and inert field should not ship to production without the decision above
  being made and recorded.

## When To Fix
The **decision** (Option A vs. Option B) should be made during Final Hardening,
before Phase 16 — it does not need code changed immediately, but it needs an
explicit answer recorded so this does not remain ambiguous indefinitely. The
**implementation** of whichever option is chosen can follow on whatever
timeline the business decision implies (Option A may be substantial new-feature
work; Option B is a small cleanup).

## Verification Plan
- If Option A: a test confirming a filed safety report against a booking sets
  `isFrozen: true`, and that such a booking is correctly excluded from
  `getEligibleBookingsForStylist`/`findEligibleForPayout` until unfrozen by an
  admin action.
- If Option B: confirm `grep -rn "isFrozen" src/` returns zero matches after
  removal, and that the existing payout-eligibility test coverage
  (`payout.service.test.js`, `payout.repository.test.js`) still passes
  unchanged — proving the field was genuinely inert and its removal changes no
  observable behavior.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
