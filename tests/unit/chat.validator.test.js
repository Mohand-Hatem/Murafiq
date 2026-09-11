import { describe, it, expect } from '@jest/globals';
import { sendMessageSchema } from '../../src/modules/chat/chat.validator.js';

/**
 * Regression test for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X12: chat moderation
 * (chat.service.js sendMessage) only scans `content` when `type === 'text'`, so a
 * message sent as `{type: 'image', content: 'call me 01012345678'}` used to skip the
 * scan entirely while storing and rendering arbitrary free text.
 */
describe('sendMessageSchema — image messages must reference a real image (X12)', () => {
  it('accepts a text message', () => {
    const result = sendMessageSchema.body.safeParse({ type: 'text', content: 'Hello!' });
    expect(result.success).toBe(true);
  });

  it('accepts an image message pointing at a real Cloudinary URL', () => {
    const result = sendMessageSchema.body.safeParse({
      type: 'image',
      content: 'https://res.cloudinary.com/demo/image/upload/v1/murafiq/chat/photo.jpg',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an image message carrying arbitrary text instead of an image URL', () => {
    const result = sendMessageSchema.body.safeParse({
      type: 'image',
      content: 'call me at 01012345678 on WhatsApp',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an image message pointing at an untrusted host (SSRF-shaped bypass)', () => {
    const result = sendMessageSchema.body.safeParse({
      type: 'image',
      content: 'https://evil.example.com/fake.jpg',
    });
    expect(result.success).toBe(false);
  });
});
