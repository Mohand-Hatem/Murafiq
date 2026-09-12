import { jest, describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { Writable } from 'stream';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

jest.unstable_mockModule('../../src/config/cloudinary.config.js', () => ({
  default: {
    uploader: {
      upload_stream: (_options, callback) => {
        const chunks = [];
        const dest = new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk);
            cb();
          },
        });
        dest.on('finish', () => {
          callback(null, {
            public_id: 'test_id',
            format: 'jpg',
            bytes: 100,
            secure_url: 'https://example.test/img.jpg',
          });
        });
        return dest;
      },
    },
    url: (publicId) => `https://res.cloudinary.com/murafiq/${publicId}?signed=1`,
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Upload Folder Role Authorization Matrix (Task B8 / S4.4)', () => {
  const clientToken = generateAccessToken({ sub: '60f719b8f1a2c81234567891', role: 'client' });
  const stylistToken = generateAccessToken({ sub: '60f719b8f1a2c81234567892', role: 'stylist' });
  const adminToken = generateAccessToken({ sub: '60f719b8f1a2c81234567893', role: 'admin' });

  const tokens = {
    client: clientToken,
    stylist: stylistToken,
    admin: adminToken,
  };

  const MATRIX = [
    ['avatars', 'client', 200],
    ['avatars', 'stylist', 200],
    ['kyc-documents', 'client', 200],
    ['kyc-documents', 'stylist', 200],
    ['portfolio', 'stylist', 200],
    ['portfolio', 'client', 403],
    ['request-images', 'client', 200],
    ['request-images', 'stylist', 403],
    ['wardrobe', 'client', 200],
    ['wardrobe', 'stylist', 403],
  ];

  it.each(MATRIX)(
    'POST /api/v1/uploads/%s as %s -> %i',
    async (folder, role, expectedStatus) => {
      const dummyBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
        0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
        0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
        0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
        0x00, 0xbf, 0x00, 0xff, 0xd9,
      ]);

      const res = await request(app)
        .post(`/api/v1/uploads/${folder}`)
        .set('Authorization', `Bearer ${tokens[role]}`)
        .attach('file', dummyBuffer, 'test.jpg');

      expect(res.status).toBe(expectedStatus);
      if (expectedStatus === 403) {
        expect(res.body.message).toMatch(/not authorized/i);
      }
    }
  );

  it('allows Admin to bypass folder restriction on any folder', async () => {
    const dummyBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
    ]);

    for (const folder of ['portfolio', 'request-images', 'wardrobe']) {
      const res = await request(app)
        .post(`/api/v1/uploads/${folder}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', dummyBuffer, 'test.jpg');

      expect(res.status).toBe(200);
    }
  });
});
