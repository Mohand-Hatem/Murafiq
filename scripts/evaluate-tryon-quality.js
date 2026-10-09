/**
 * Phase 15F — Virtual Try-On Controlled Quality Evaluation Runner
 *
 * Runs the 11-scenario evaluation dataset against the active image generation provider,
 * measuring latency, image resolution compliance, buffer integrity, and memory consumption.
 * Supports live Gemini evaluation, output image disk export, and single-scenario filtering.
 *
 * Usage:
 *   node scripts/evaluate-tryon-quality.js
 *   node scripts/evaluate-tryon-quality.js --provider=gemini --save-outputs
 *   node scripts/evaluate-tryon-quality.js --provider=mock --scenario=tryon_eval_001_single_top
 */

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

import fs from 'node:fs';
import path from 'node:path';
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
 * Creates a realistic synthetic person image with head, neck, and torso outlines.
 *
 * @param {number} [width=1024]
 * @param {number} [height=1024]
 * @returns {Promise<Buffer>}
 */
export async function createSyntheticPerson(width = 1024, height = 1024) {
  const svgPerson = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#E8ECEF"/>
          <stop offset="100%" stop-color="#CFD6DC"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <ellipse cx="${width * 0.5}" cy="${height * 0.22}" rx="${width * 0.1}" ry="${height * 0.13}" fill="#D8A882"/>
      <rect x="${width * 0.46}" y="${height * 0.33}" width="${width * 0.08}" height="${height * 0.08}" fill="#C99772"/>
      <path d="M ${width * 0.25} ${height * 0.45} Q ${width * 0.5} ${height * 0.38} ${width * 0.75} ${height * 0.45} L ${width * 0.68} ${height * 0.85} L ${width * 0.32} ${height * 0.85} Z" fill="#88929A"/>
      <path d="M ${width * 0.25} ${height * 0.45} L ${width * 0.18} ${height * 0.82}" stroke="#D8A882" stroke-width="${width * 0.06}" stroke-linecap="round"/>
      <path d="M ${width * 0.75} ${height * 0.45} L ${width * 0.82} ${height * 0.82}" stroke="#D8A882" stroke-width="${width * 0.06}" stroke-linecap="round"/>
    </svg>
  `;
  return sharp(Buffer.from(svgPerson))
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Creates a realistic synthetic garment image for a specific slot.
 *
 * @param {number} [width=512]
 * @param {number} [height=512]
 * @param {string} [slot='top']
 * @param {string} [color='#2C3E50']
 * @returns {Promise<Buffer>}
 */
export async function createSyntheticGarment(width = 512, height = 512, slot = 'top', color = '#2C3E50') {
  let pathD = '';
  if (slot === 'top' || slot === 'outerwear') {
    pathD = `M ${width * 0.2} ${height * 0.25} L ${width * 0.35} ${height * 0.15} L ${width * 0.65} ${height * 0.15} L ${width * 0.8} ${height * 0.25} L ${width * 0.72} ${height * 0.85} L ${width * 0.28} ${height * 0.85} Z`;
  } else if (slot === 'bottom') {
    pathD = `M ${width * 0.3} ${height * 0.15} L ${width * 0.7} ${height * 0.15} L ${width * 0.75} ${height * 0.85} L ${width * 0.53} ${height * 0.85} L ${width * 0.5} ${height * 0.45} L ${width * 0.47} ${height * 0.85} L ${width * 0.25} ${height * 0.85} Z`;
  } else if (slot === 'dress') {
    pathD = `M ${width * 0.32} ${height * 0.15} L ${width * 0.68} ${height * 0.15} L ${width * 0.82} ${height * 0.9} L ${width * 0.18} ${height * 0.9} Z`;
  } else {
    pathD = `M ${width * 0.2} ${height * 0.4} L ${width * 0.8} ${height * 0.4} L ${width * 0.7} ${height * 0.75} L ${width * 0.3} ${height * 0.75} Z`;
  }

  const svgGarment = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#F5F7FA"/>
      <path d="${pathD}" fill="${color}" stroke="#1A252F" stroke-width="2"/>
    </svg>
  `;
  return sharp(Buffer.from(svgGarment))
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Parses command-line arguments.
 *
 * @returns {Object}
 */
export const parseCliOptions = () => {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--provider=')) {
      options.providerName = arg.split('=')[1];
    } else if (arg.startsWith('--save-outputs')) {
      const parts = arg.split('=');
      options.saveOutputs = true;
      if (parts[1]) options.outputDir = parts[1];
    } else if (arg.startsWith('--scenario=')) {
      options.scenarioFilter = arg.split('=')[1];
    } else if (arg === '--silent') {
      options.silent = true;
    }
  }
  return options;
};

/**
 * Executes the full evaluation suite across the 11 scenarios.
 *
 * @param {Object} [options]
 * @param {Object} [options.provider] - Optional image provider override
 * @param {string} [options.providerName] - Optional provider name ('gemini' | 'mock')
 * @param {boolean} [options.saveOutputs=false] - Whether to write output images to disk
 * @param {string} [options.outputDir] - Directory where output images will be stored
 * @param {string} [options.scenarioFilter] - Optional filter by scenario ID
 * @param {boolean} [options.silent=false] - Whether to suppress console output
 * @returns {Promise<Object>} Evaluation summary and per-scenario results
 */
export async function runTryOnEvaluation(options = {}) {
  const {
    provider: customProvider,
    providerName,
    saveOutputs = false,
    outputDir = 'artifacts/tryon-eval-results',
    scenarioFilter = null,
    silent = false,
  } = options;

  const targetProviderName = providerName || process.env.AI_IMAGE_PROVIDER || 'mock';
  const provider = customProvider || imageProviderFactory.getImageProvider(targetProviderName);

  const log = (...args) => {
    if (!silent) {
      console.log(...args);
    }
  };

  const scenariosToRun = scenarioFilter
    ? TRYON_EVAL_SCENARIOS.filter((s) => s.id.includes(scenarioFilter))
    : TRYON_EVAL_SCENARIOS;

  log('\n===============================================================');
  log('   Murafiq Phase 15F — Virtual Try-On Evaluation Runner');
  log('===============================================================');
  log(`Active Provider : ${provider.name || provider.constructor.name}`);
  log(`Total Scenarios : ${scenariosToRun.length} (out of ${TRYON_EVAL_SCENARIOS.length})`);
  log(`Save Outputs    : ${saveOutputs ? `Yes (${outputDir})` : 'No'}`);
  log(`Environment     : ${envConfig.NODE_ENV || 'development'}\n`);

  if (saveOutputs) {
    const resolvedDir = path.resolve(process.cwd(), outputDir);
    await fs.promises.mkdir(resolvedDir, { recursive: true });
  }

  const results = [];
  const latencies = [];
  const initialMemory = process.memoryUsage().heapUsed;

  for (const scenario of scenariosToRun) {
    const startTime = Date.now();
    let passed = false;
    let errorDetail = null;
    let outputMetadata = null;
    let bufferSizeKb = 0;

    try {
      // 1. Synthesize person image with anatomical structure
      const personImageBuffer = await createSyntheticPerson(1024, 1024);

      // 2. Synthesize garment images with realistic shapes and colors per slot
      const garmentColors = {
        top: '#3498DB',
        bottom: '#2C3E50',
        outerwear: '#795548',
        dress: '#16A085',
        shoes: '#3E2723',
      };

      const garmentImages = [];
      for (const garment of scenario.garments) {
        const hex = garmentColors[garment.slot] || '#607D8B';
        const buffer = await createSyntheticGarment(512, 512, garment.slot, hex);
        garmentImages.push({
          slot: garment.slot,
          buffer,
          source: garment.source,
          category: garment.category,
          label: garment.name,
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

      // 5. Optionally save output image to disk
      if (saveOutputs) {
        const resolvedPath = path.resolve(process.cwd(), outputDir, `${scenario.id}.jpg`);
        await fs.promises.writeFile(resolvedPath, genResult.imageBuffer);
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
  const meanLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)) || 0;
  const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
  const totalSizeKb = results.filter((r) => r.passed).reduce((sum, r) => sum + r.sizeKb, 0);
  const avgSizeKb = passedCount > 0 ? Math.round(totalSizeKb / passedCount) : 0;

  log('\n---------------------------------------------------------------');
  log('                     EVALUATION SUMMARY');
  log('---------------------------------------------------------------');
  log(`Total Scenarios Tested : ${results.length}`);
  log(`Passed                 : ${passedCount} (${results.length ? Math.round(passedCount / results.length * 100) : 0}%)`);
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
    successRatePct: results.length ? Math.round(passedCount / results.length * 100) : 0,
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
  const cliOptions = parseCliOptions();
  runTryOnEvaluation(cliOptions)
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
