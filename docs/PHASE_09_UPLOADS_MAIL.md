# Phase 9 — Uploads (Cloudinary) & Mail (Provider Pattern)

## Goal
A generic, reusable upload module (Cloudinary + Multer) used by every module that needs images, and a proper Mail module with templates and a provider interface — replacing Phase 1's temporary inline mail call without changing its call signature.

## Depends on
Phase 0 (config). Can technically be built any time after Phase 0 — placed here because most upload use-cases (profile, national ID, portfolio, request images, chat images) already exist by this point.

---

## Steps

### 0. Dependencies
Install `sharp` for server-side image compression prior to Cloudinary upload: `npm install sharp`.

### 1. Multer middleware (`upload.middleware.js` / `multer.middleware.js`)
Memory storage (not disk) so buffers stream directly to Cloudinary:
```js
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
```

### 2. Sharp compression helper (`upload.service.js`)
Compress and optimize image buffers in memory before streaming to Cloudinary. Exposed as a single transform helper function in `upload.service.js` and reused across all upload paths (do NOT scatter Sharp calls across module code):
```js
async function compressImage(buffer, mimeType) {
  let pipeline = sharp(buffer).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true });
  if (mimeType === 'image/webp') {
    pipeline = pipeline.webp({ quality: 82 });
  } else if (mimeType === 'image/png') {
    pipeline = pipeline.png({ quality: 85, compressionLevel: 8 });
  } else {
    pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  }
  return pipeline.toBuffer();
}
```
Pipeline flow: Buffer in → compressed buffer out → Cloudinary `upload_stream`.

### 3. Cloudinary service (`upload.service.js`)
```js
async function uploadBuffer(buffer, folder, mimeType) {
  const compressedBuffer = await compressImage(buffer, mimeType);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder }, (err, result) => {
      if (err) return reject(err);
      resolve({ url: result.secure_url, publicId: result.public_id });
    });
    streamifier.createReadStream(compressedBuffer).pipe(stream);
  });
}
```
Folders: `murafiq/profile`, `murafiq/national-id`, `murafiq/portfolio`, `murafiq/requests`, `murafiq/chat`.

### 4. Generic upload endpoint
- `POST /uploads/:folder` — validates `folder` against an allow-list, returns `{ url, publicId }`. Other modules (`users`, `stylists`, `requests`, `chat`) call this or embed the middleware directly on their own routes — pick **one** pattern consistently (recommended: a shared middleware + service function imported by each module's own route, so validation/authorization stays with the owning module rather than a single generic uploads gateway that would need to know every module's permission rules).

### 5. Mail provider interface (`mail-provider.interface.js`)
```js
class MailProviderInterface {
  async send({ to, subject, html }) { throw new Error('Not implemented'); }
}
```

### 6. Resend provider — ACTIVE
```js
class ResendProvider extends MailProviderInterface {
  constructor() {
    super();
    this.client = new Resend(env.RESEND_API_KEY);
  }
  async send({ to, subject, html }) {
    return this.client.emails.send({ from: env.MAIL_FROM_ADDRESS, to, subject, html });
  }
}
```
> Requires a verified sending domain in the Resend dashboard for production; Resend's own sandbox domain works for dev/test without domain verification.

### 7. SendGrid/SES provider — 🔲 SKELETON (optional fallback)
```js
class SendgridProvider extends MailProviderInterface {
  async send({ to, subject, html }) {
    throw new ApiError(501, 'SendGrid provider not yet implemented');
  }
}
```

### 8. `mail.service.js` — provider selection (mirrors `payment.service.js` pattern)
```js
const provider = env.MAIL_PROVIDER === 'sendgrid' ? new SendgridProvider() : new ResendProvider();
module.exports = { send: (opts) => provider.send(opts) };
```
**Replace** Phase 1's inline Resend call with `mailService.send(...)` — same function signature, no changes needed anywhere else.

### 9. Templates (`templates/*.template.js`)
Each exports a function `(data) => ({ subject, html })`:
- `welcome.template.js`
- `otp.template.js`
- `verify-email.template.js`
- `forgot-password.template.js`
- `booking-confirmation.template.js`

Keep HTML simple inline strings or a minimal templating helper — no need for a heavy template engine at this size.

### 10. Queue-based sending (stub now, wire in Phase 12)
`mail.service.js#send()` should be called **through** a BullMQ job add (`mailQueue.add('send-mail', payload)`) rather than directly, so a slow/failing mail provider never blocks a request. The actual queue/worker files are built in Phase 12 — for this phase, it's acceptable to call `provider.send()` synchronously and swap in the queue call in Phase 12 without changing any calling code (`mailService.send()` keeps the same external signature either way).

---

## Definition of Done

- [ ] Uploading an image via any module's endpoint returns a working Cloudinary URL, correctly folder-scoped.
- [ ] File size/type limits enforced by Multer (reject oversized/non-image files with a clean error).
- [ ] Uploaded image size is meaningfully smaller than the original when source > 500KB; dimensions never exceed the configured max (1920x1920).
- [ ] `mailService.send()` successfully delivers a real email via Resend in a dev test.
- [ ] Switching `MAIL_PROVIDER=sendgrid` in env cleanly returns `501` everywhere, no crash.
- [ ] All 5 templates render valid HTML with interpolated data.
- [ ] Phase 1's OTP/verification emails now flow through `mail.service.js`, not the old inline function (refactor confirmed, no behavior change).
- [ ] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
