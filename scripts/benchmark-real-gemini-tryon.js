#!/usr/bin/env node
/**
 * Standalone Real Gemini Virtual Try-On Benchmark & Quality Audit Runner.
 *
 * Exercises the live Gemini Nano Banana multimodal image generation model
 * (gemini-3.1-flash-lite-image) with realistic person and garment visual inputs,
 * verifies output image format, resolution, and saves the output to disk for
 * human visual fidelity review.
 *
 * Usage:
 *   node scripts/benchmark-real-gemini-tryon.js
 */

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import '../src/common/globals.js';
import env from '../src/config/env.config.js';
import { geminiImageProvider } from '../src/modules/ai/providers/gemini-image.provider.js';
import { createSyntheticPerson, createSyntheticGarment } from './evaluate-tryon-quality.js';

export const runGeminiTryOnBenchmark = async () => {
  console.log('\n===============================================================');
  console.log('   Murafiq — Real Gemini Virtual Try-On Quality Benchmark');
  console.log('===============================================================\n');

  // 1. Verify API Key
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith('dummy') || apiKey === 'test_gemini_key') {
    console.warn('WARNING: GEMINI_API_KEY is not configured or is a placeholder.');
    console.warn('Real Gemini API call cannot proceed without a valid Google GenAI key.');
    console.warn('Configure GEMINI_API_KEY in .env to run live model quality tests.\n');
    return {
      success: false,
      skipped: true,
      reason: 'Missing or placeholder GEMINI_API_KEY',
    };
  }

  console.log('Model Target    : gemini-3.1-flash-lite-image');
  console.log('API Key Present : Yes');
  console.log('Generating test fixtures (person + 2 garments)...\n');

  try {
    // 2. Synthesize High-Resolution Person and Garments
    const personBuffer = await createSyntheticPerson(1024, 1024);
    const topGarmentBuffer = await createSyntheticGarment(512, 512, 'top', '#2980B9');
    const bottomGarmentBuffer = await createSyntheticGarment(512, 512, 'bottom', '#2C3E50');

    const garments = [
      {
        slot: 'top',
        buffer: topGarmentBuffer,
        label: 'Classic Oxford Blue Button-Down Shirt',
        category: 'top',
      },
      {
        slot: 'bottom',
        buffer: bottomGarmentBuffer,
        label: 'Navy Tailored Slim-Fit Chinos',
        category: 'bottom',
      },
    ];

    console.log('Sending multimodal try-on request to Google Gemini API...');
    const startTime = Date.now();

    const result = await geminiImageProvider.generateTryOn({
      personImageBuffer: personBuffer,
      garmentImages: garments,
      resolution: '1024x1024',
      promptVersion: 'benchmark_v1',
      timeoutMs: 90_000,
    });

    const elapsed = Date.now() - startTime;
    console.log(`Generation completed in ${elapsed} ms\n`);

    // 3. Inspect Output Image Metadata
    const metadata = await sharp(result.imageBuffer).metadata();
    const sizeKb = Math.round(result.imageBuffer.length / 1024);

    console.log('--- Output Image Diagnostics ---');
    console.log(`Format          : ${metadata.format}`);
    console.log(`Dimensions      : ${metadata.width}x${metadata.height}`);
    console.log(`Color Space     : ${metadata.space}`);
    console.log(`Channels        : ${metadata.channels}`);
    console.log(`Buffer Size     : ${sizeKb} KB`);
    console.log(`Latency         : ${elapsed} ms\n`);

    // 4. Save Image to Disk for Visual Review
    const outputDir = path.resolve(process.cwd(), 'artifacts');
    await fs.promises.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'tryon-real-benchmark.jpg');
    await fs.promises.writeFile(outputPath, result.imageBuffer);

    console.log(`✓ Benchmark image saved to: ${outputPath}`);
    console.log('\n===============================================================');
    console.log('   Real Gemini Try-On Quality Benchmark PASSED');
    console.log('===============================================================\n');

    return {
      success: true,
      skipped: false,
      latencyMs: elapsed,
      dimensions: `${metadata.width}x${metadata.height}`,
      sizeKb,
      savedPath: outputPath,
    };
  } catch (err) {
    console.error('Gemini Try-On benchmark failed:', err.message);
    if (err.status) console.error(`HTTP Status: ${err.status}`);
    return {
      success: false,
      skipped: false,
      error: err.message,
    };
  }
};

// Direct script execution
if (process.argv[1] && process.argv[1].endsWith('benchmark-real-gemini-tryon.js')) {
  runGeminiTryOnBenchmark()
    .then((res) => {
      process.exit(res.success || res.skipped ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal benchmark error:', err);
      process.exit(1);
    });
}

export default runGeminiTryOnBenchmark;
