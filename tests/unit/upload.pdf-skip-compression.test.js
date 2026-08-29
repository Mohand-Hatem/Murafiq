import { jest } from '@jest/globals';
import { Buffer } from 'buffer';
import { Writable } from 'stream';
import sharp from 'sharp';

/**
 * Regression test for the PDF-skip guard in upload.service.js#uploadFile().
 *
 * Sharp cannot decode a PDF, so uploadFile() only calls compressImage() when
 * file.mimetype.startsWith('image/'). This wasn't explicitly requested when Sharp
 * compression was added — it's a correct catch that prevents Sharp choking on
 * KYC PDF uploads.
 *
 * The tricky part: uploadFile() also wraps compressImage() in a try/catch that
 * falls back to the original buffer on failure, so a test using genuinely
 * undecodable bytes (garbage, or a real PDF) can't tell "the mimetype guard
 * skipped compression" apart from "compression was attempted, Sharp threw, and
 * the fallback silently produced the same result" — both paths return the
 * original buffer unchanged either way.
 *
 * To actually distinguish the two, this test uses a buffer that IS a valid,
 * Sharp-decodable image but is tagged with a non-image mimetype. If the
 * explicit guard is present, it's skipped (buffer passes through byte-for-byte
 * unchanged). If someone removes the guard so every buffer is attempted, Sharp
 * *would* successfully decode and resize/re-encode this one — proving the test
 * actually exercises the guard, not the fallback.
 */

let capturedBuffer;

jest.unstable_mockModule('../../src/config/cloudinary.config.js', () => ({
  default: {
    uploader: {
      upload_stream: (_options, callback) => {
        // A real Writable so streamifier's .pipe() (backpressure, 'finish' event
        // wiring) behaves exactly as it would against the real Cloudinary SDK.
        const chunks = [];
        const dest = new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk);
            cb();
          },
        });
        dest.on('finish', () => {
          capturedBuffer = Buffer.concat(chunks);
          callback(null, {
            public_id: 'test_id',
            format: 'bin',
            bytes: capturedBuffer.length,
            secure_url: 'https://example.test/x',
          });
        });
        return dest;
      },
    },
  },
}));

const { default: uploadService } = await import('../../src/modules/uploads/upload.service.js');

describe('uploadFile() skips Sharp compression for non-image mimetypes', () => {
  beforeEach(() => {
    capturedBuffer = undefined;
  });

  it('passes a decodable image through byte-for-byte unmodified when mimetype is application/pdf', async () => {
    // Genuinely Sharp-decodable — a 2400x1600 JPEG. If the guard is removed,
    // Sharp WILL successfully compress this (proving the guard, not the
    // try/catch fallback, is what's under test).
    const decodableImageBuffer = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();

    await uploadService.uploadFile({ id: 'u1' }, 'kyc-documents', {
      buffer: decodableImageBuffer,
      mimetype: 'application/pdf',
    });

    expect(capturedBuffer).toBeInstanceOf(Buffer);
    expect(Buffer.compare(capturedBuffer, decodableImageBuffer)).toBe(0);

    // Sanity check the buffer really would have compressed if attempted —
    // otherwise this test could pass for the wrong reason.
    const wouldBeCompressed = await sharp(decodableImageBuffer)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    expect(Buffer.compare(capturedBuffer, wouldBeCompressed)).not.toBe(0);
  });
});
