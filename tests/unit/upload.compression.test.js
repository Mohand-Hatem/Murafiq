import sharp from 'sharp';
import '../../src/common/globals.js';
import { compressImage } from '../../src/modules/uploads/upload.service.js';

describe('Upload Service — Sharp Image Compression Tests', () => {
  it('resizes an oversized image to fit within 1920x1920 without enlargement', async () => {
    // Generate a 2400x1600 test image buffer with Sharp
    const inputBuffer = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const compressedBuffer = await compressImage(inputBuffer, 'image/jpeg');
    const metadata = await sharp(compressedBuffer).metadata();

    expect(metadata.width).toBeLessThanOrEqual(1920);
    expect(metadata.height).toBeLessThanOrEqual(1920);
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1280); // Maintains 3:2 aspect ratio
  });

  it('does not upscale smaller images (< 1920x1920)', async () => {
    const inputBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 0, g: 255, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const compressedBuffer = await compressImage(inputBuffer, 'image/jpeg');
    const metadata = await sharp(compressedBuffer).metadata();

    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(600);
  });

  it('compresses PNG format', async () => {
    const inputBuffer = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const compressedBuffer = await compressImage(inputBuffer, 'image/png');
    const metadata = await sharp(compressedBuffer).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(500);
  });

  it('compresses WebP format', async () => {
    const inputBuffer = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: { r: 255, g: 255, b: 0 },
      },
    })
      .webp()
      .toBuffer();

    const compressedBuffer = await compressImage(inputBuffer, 'image/webp');
    const metadata = await sharp(compressedBuffer).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(600);
  });
});
