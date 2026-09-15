import sharp from 'sharp';
import '../../src/common/globals.js';
import {
  TRYON_EVAL_SCENARIOS,
  EVALUATION_CATEGORIES,
} from '../ai/tryon-eval/tryon-eval-dataset.js';
import {
  createSyntheticImage,
  runTryOnEvaluation,
} from '../../scripts/evaluate-tryon-quality.js';
import { MockImageProvider, mockImageProvider } from '../../src/modules/ai/providers/mock-image.provider.js';

describe('Phase 15F Step 9 — Try-On Evaluation Dataset & Quality Runner', () => {
  describe('Dataset Structure & Completeness', () => {
    it('contains exactly 11 curated evaluation scenarios', () => {
      expect(TRYON_EVAL_SCENARIOS).toHaveLength(11);
    });

    it('defines all 6 evaluation categories in EVALUATION_CATEGORIES', () => {
      expect(EVALUATION_CATEGORIES).toEqual([
        'single_garment',
        'multi_garment',
        'mixed_source',
        'texture_pattern',
        'lighting_contrast',
        'silhouette_complexity',
      ]);
    });

    it('ensures every scenario has unique ID and name', () => {
      const ids = TRYON_EVAL_SCENARIOS.map((s) => s.id);
      const names = TRYON_EVAL_SCENARIOS.map((s) => s.name);
      expect(new Set(ids).size).toBe(TRYON_EVAL_SCENARIOS.length);
      expect(new Set(names).size).toBe(TRYON_EVAL_SCENARIOS.length);
    });

    it('validates scenario schemas (person, garments, evaluationCriteria, resolution)', () => {
      for (const scenario of TRYON_EVAL_SCENARIOS) {
        expect(scenario.id).toMatch(/^tryon_eval_\d{3}_[a-z0-9_]+$/);
        expect(scenario.name).toBeTruthy();
        expect(EVALUATION_CATEGORIES).toContain(scenario.category);
        expect(scenario.description).toBeTruthy();

        expect(scenario.person).toBeDefined();
        expect(scenario.person.description).toBeTruthy();
        expect(scenario.person.pose).toBeTruthy();

        expect(Array.isArray(scenario.garments)).toBe(true);
        expect(scenario.garments.length).toBeGreaterThanOrEqual(1);
        expect(scenario.garments.length).toBeLessThanOrEqual(4);

        for (const garment of scenario.garments) {
          expect(['top', 'bottom', 'outerwear', 'dress', 'shoes']).toContain(garment.slot);
          expect(garment.name).toBeTruthy();
          expect(['wardrobe', 'upload']).toContain(garment.source);
        }

        expect(scenario.evaluationCriteria).toBeDefined();
        expect(scenario.evaluationCriteria.facialResemblance).toBeTruthy();
        expect(scenario.evaluationCriteria.drapeRealism).toBeTruthy();
        expect(scenario.evaluationCriteria.edgeBoundaries).toBeTruthy();
        expect(scenario.evaluationCriteria.colorAccuracy).toBeTruthy();
        expect(scenario.expectedResolution).toBe('1024x1024');
      }
    });
  });

  describe('createSyntheticImage Helper', () => {
    it('creates a valid JPEG buffer with exact specified dimensions', async () => {
      const buffer = await createSyntheticImage(512, 512, { r: 100, g: 150, b: 200 });
      expect(Buffer.isBuffer(buffer)).toBe(true);

      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(512);
      expect(metadata.format).toBe('jpeg');
    });
  });

  describe('runTryOnEvaluation Execution', () => {
    afterEach(() => {
      mockImageProvider.reset();
    });

    it('runs all 11 scenarios with MockImageProvider and reports 100% success', async () => {
      const mockProvider = new MockImageProvider();
      const summary = await runTryOnEvaluation({ provider: mockProvider, silent: true });

      expect(summary.totalScenarios).toBe(11);
      expect(summary.passedCount).toBe(11);
      expect(summary.failedCount).toBe(0);
      expect(summary.successRatePct).toBe(100);

      expect(summary.latency.meanMs).toBeGreaterThan(0);
      expect(summary.averageSizeKb).toBeGreaterThan(0);
      expect(summary.scenarios).toHaveLength(11);

      for (const result of summary.scenarios) {
        expect(result.passed).toBe(true);
        expect(result.dimensions).toBe('1024x1024');
        expect(result.sizeKb).toBeGreaterThan(0);
        expect(result.latencyMs).toBeGreaterThan(0);
      }
    });

    it('records failed scenarios gracefully when provider throws an error', async () => {
      const failingProvider = new MockImageProvider();
      failingProvider.setSimulatedError(new Error('GPU out of memory'));

      const summary = await runTryOnEvaluation({ provider: failingProvider, silent: true });

      expect(summary.totalScenarios).toBe(11);
      expect(summary.passedCount).toBe(0);
      expect(summary.failedCount).toBe(11);
      expect(summary.successRatePct).toBe(0);

      for (const result of summary.scenarios) {
        expect(result.passed).toBe(false);
        expect(result.error).toContain('GPU out of memory');
      }
    });
  });
});
