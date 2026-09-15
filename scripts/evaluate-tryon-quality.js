/**
 * Phase 15F — Virtual Try-On Controlled Quality Evaluation Runner
 *
 * Runs the 11-scenario evaluation dataset against the active image generation provider,
 * measuring latency, image resolution compliance, buffer integrity, and memory consumption.
 *
 * Usage:
 *   node scripts/evaluate-tryon-quality.js
 */

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { TRYON_EVAL_SCENARIOS } from '../tests/ai/tryon-eval/tryon-eval-dataset.js';
import imageProviderFactory from '../src/modules/ai/providers/image-provider.factory.js';
import envConfig from '../src/config/env.config.js';

/**
 * Creates a synthetic realistic image buffer for testing evaluation scenarios.
 *
 * @param {number} width
 * @param {number} height
 * @param {{ r: number, g: number, b: number }} background
 * @returns {Promise<Buffer>}
 */
export async function createSyntheticImage(width = 1024, height = 1024, background = { r: 220, g: 225, b: 230 }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background,
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Executes the full evaluation suite across the 11 scenarios.
 *
 * @param {Object} [options]
 * @param {Object} [options.provider] - Optional image provider override
 * @param {boolean} [options.silent=false] - Whether to suppress console output
 * @returns {Promise<Object>} Evaluation summary and per-scenario results
 */
export async function runTryOnEvaluation(options = {}) {
  const { provider: customProvider, silent = false } = options;
  const provider = customProvider || imageProviderFactory.getImageProvider();

  const log = (...args) => {
    if (!silent) {
      console.log(...args);
    }
  };

  log('\n===============================================================');
  log('   Murafiq Phase 15F — Virtual Try-On Evaluation Runner');
  log('===============================================================');
  log(`Active Provider : ${provider.name || provider.constructor.name}`);
  log(`Total Scenarios : ${TRYON_EVAL_SCENARIOS.length}`);
  log(`Environment     : ${envConfig.NODE_ENV || 'development'}\n`);

  const results = [];
  const latencies = [];
  const initialMemory = process.memoryUsage().heapUsed;

  for (const scenario of TRYON_EVAL_SCENARIOS) {
    const startTime = Date.now();
    let passed = false;
    let errorDetail = null;
    let outputMetadata = null;
    let bufferSizeKb = 0;

    try {
      // 1. Synthesize person image
      const personImageBuffer = await createSyntheticImage(1024, 1024, { r: 210, g: 215, b: 220 });

      // 2. Synthesize garment images with distinct tints per slot
      const garmentColors = {
        top: { r: 240, g: 240, b: 240 },
        bottom: { r: 40, g: 60, b: 100 },
        outerwear: { r: 160, g: 120, b: 80 },
        dress: { r: 20, g: 120, b: 80 },
        shoes: { r: 60, g: 40, b: 30 },
      };

      const garmentImages = [];
      for (const garment of scenario.garments) {
        const bg = garmentColors[garment.slot] || { r: 150, g: 150, b: 150 };
        const buffer = await createSyntheticImage(512, 512, bg);
        garmentImages.push({
          slot: garment.slot,
          buffer,
          source: garment.source,
          category: garment.category,
        });
      }

      // 3. Execute generation
      const genResult = await provider.generateTryOn({
        personImageBuffer,
        garmentImages,
        resolution: scenario.expectedResolution || '1024x1024',
        promptVersion: 'eval_v1',
        options: {
          resolution: scenario.expectedResolution || '1024x1024',
          promptVersion: 'eval_v1',
        },
      });

      const elapsed = Date.now() - startTime;
      latencies.push(elapsed);

      // 4. Validate output
      if (!genResult || !Buffer.isBuffer(genResult.imageBuffer)) {
        throw new Error('Image provider returned null or non-buffer output');
      }

      bufferSizeKb = Math.round(genResult.imageBuffer.length / 1024);
      outputMetadata = await sharp(genResult.imageBuffer).metadata();

      const [expectedW, expectedH] = (scenario.expectedResolution || '1024x1024')
        .split('x')
        .map(Number);

      const dimensionsValid =
        outputMetadata.width === expectedW && outputMetadata.height === expectedH;
      const formatValid = outputMetadata.format === 'jpeg';

      if (!dimensionsValid) {
        throw new Error(`Invalid dimensions: expected ${expectedW}x${expectedH}, received ${outputMetadata.width}x${outputMetadata.height}`);
      }

      if (!formatValid) {
        throw new Error(`Invalid format: expected jpeg, received ${outputMetadata.format}`);
      }

      passed = true;

      results.push({
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        passed: true,
        latencyMs: elapsed,
        dimensions: `${outputMetadata.width}x${outputMetadata.height}`,
        sizeKb: bufferSizeKb,
        garmentsCount: scenario.garments.length,
      });

      log(`  ✓ [PASS] ${scenario.id.padEnd(38)} | ${String(elapsed).padStart(4)}ms | ${outputMetadata.width}x${outputMetadata.height} | ${bufferSizeKb} KB`);
    } catch (err) {
      const elapsed = Date.now() - startTime;
      latencies.push(elapsed);
      errorDetail = err.message;

      results.push({
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        passed: false,
        latencyMs: elapsed,
        error: errorDetail,
        garmentsCount: scenario.garments.length,
      });

      log(`  ✗ [FAIL] ${scenario.id.padEnd(38)} | ${String(elapsed).padStart(4)}ms | ERROR: ${errorDetail}`);
    }
  }

  const finalMemory = process.memoryUsage().heapUsed;
  const memoryDeltaMb = Math.round((finalMemory - initialMemory) / (1024 * 1024) * 100) / 100;

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const minLatency = sortedLatencies[0] || 0;
  const maxLatency = sortedLatencies[sortedLatencies.length - 1] || 0;
  const meanLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) || 0;
  const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
  const totalSizeKb = results.filter((r) => r.passed).reduce((sum, r) => sum + r.sizeKb, 0);
  const avgSizeKb = passedCount > 0 ? Math.round(totalSizeKb / passedCount) : 0;

  log('\n---------------------------------------------------------------');
  log('                     EVALUATION SUMMARY');
  log('---------------------------------------------------------------');
  log(`Total Scenarios Tested : ${results.length}`);
  log(`Passed                 : ${passedCount} (${Math.round(passedCount / results.length * 100)}%)`);
  log(`Failed                 : ${failedCount}`);
  log(`Mean Latency           : ${meanLatency} ms`);
  log(`P95 Latency            : ${p95Latency} ms`);
  log(`Latency Range          : ${minLatency} ms - ${maxLatency} ms`);
  log(`Average Output Size    : ${avgSizeKb} KB`);
  log(`Heap Memory Delta      : ${memoryDeltaMb} MB`);
  log('===============================================================\n');

  return {
    timestamp: new Date().toISOString(),
    provider: provider.name || provider.constructor.name,
    totalScenarios: results.length,
    passedCount,
    failedCount,
    successRatePct: Math.round(passedCount / results.length * 100),
    latency: {
      meanMs: meanLatency,
      p95Ms: p95Latency,
      minMs: minLatency,
      maxMs: maxLatency,
    },
    averageSizeKb: avgSizeKb,
    memoryDeltaMb,
    scenarios: results,
  };
}

// Execute directly if run as a CLI script
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runTryOnEvaluation()
    .then((summary) => {
      if (summary.failedCount > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Evaluation runner failed:', err);
      process.exit(1);
    });
}
