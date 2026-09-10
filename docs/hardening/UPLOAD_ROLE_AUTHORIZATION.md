# Upload Endpoint — No Per-Folder Role Authorization

## Status
DEFERRED — NOT FIXED

## Priority
HIGH

## Why It Was Deferred
This was identified in the pre-Phase-15 audit as a real security gap, but it sits
in the uploads module (Phase 9), entirely outside the scope explicitly given for
the fix pass (Tier 0–3: payouts IDOR, Phase 15 blockers, money correctness,
booking/event/validator concurrency bugs). It was correctly out of scope for that
pass and must not be forgotten simply because it wasn't touched.

## Current Problem
`POST /api/v1/uploads/:folder` requires authentication but performs no check on
*which* folder a given role may write to. The service function receives the
authenticated `user` but never references it again:

```js
export const uploadFile = async (user, folder, file) => {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw new ApiError(400, `Invalid upload folder '${folder}'. Allowed: ${...}`);
  }
  // `user` is not read anywhere below this line.
  ...
```

`ALLOWED_FOLDERS` is `avatars`, `kyc-documents`, `portfolio`, `request-images`,
`wardrobe` — a flat allowlist with no association to roles. Any authenticated
user, regardless of role, can `POST` to any folder in that set, including
`kyc-documents`.

## Evidence
- `src/modules/uploads/upload.routes.js` — `router.post('/:folder',
  authMiddleware, uploadSingle, uploadController.uploadFile);` — no `restrictTo`,
  no folder-to-role mapping.
- `src/modules/uploads/upload.service.js` — `uploadFile(user, folder, file)` and
  `ALLOWED_FOLDERS` (both `kyc-documents` and `wardrobe` present, with no
  distinction in who may write to either).
- The `user` parameter is threaded all the way from the controller into the
  service and then never read — a strong signal the check was intended and
  never implemented, not that it was deliberately omitted.

## Risk / Impact
Any authenticated principal — client, stylist, or operator — can write into the
`kyc-documents` folder, which backs the identity-verification pipeline. This does
not by itself forge a *verification decision* (the verification review flow is a
separate admin action), but it does mean the KYC document bucket is not actually
restricted to the parties it is meant to be restricted to, and a client could, for
example, seed `portfolio` assets (a stylist-only concept) or push arbitrary
content into a bucket intended for sensitive identity documents.

## Expected Future Fix
Introduce an explicit folder → allowed-roles map (e.g. `kyc-documents`: the
uploading user's own identity documents only, `portfolio`: stylists only,
`wardrobe`: clients only, `avatars`/`request-images`: any authenticated user) and
enforce it in `upload.service.uploadFile` using the `user` parameter it already
receives, before the file is compressed/uploaded. This keeps the check at the
service boundary (consistent with the rest of the codebase's
`Route → Validator → Controller → Service` layering) rather than only at the
route layer, so any future direct caller of the service is protected too.

## Dependencies
- No phase dependency. Self-contained fix inside the already-shipped uploads
  module (Phase 9).
- Related but separate: the KYC document *review* flow (admin viewing uploaded
  documents) already has its own signed-URL mechanism
  (`getSignedKycUrl`) that exists but is not currently wired into the admin
  verification response — worth revisiting in the same pass, though it is a
  distinct gap (visibility, not write-authorization) and not part of this item.

## When To Fix
Before Production / During Final Hardening.

## Verification Plan
- HTTP-level authorization test (matching the pattern established in
  `tests/integration/payout.authorization.test.js` from the pre-Phase-15 fix
  pass): a client attempting `POST /uploads/kyc-documents` for another user's
  identity documents, or a client attempting `POST /uploads/portfolio`, should be
  rejected with 403.
- Confirm the legitimate paths still work: a client uploading to `wardrobe` or
  their own `kyc-documents`, a stylist uploading to `portfolio`, either role
  uploading to `avatars`/`request-images`.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
