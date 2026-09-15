/**
 * Phase 15D Step 1 — Fashion Knowledge Corpus Verification Tests.
 *
 * Verifies:
 * 1. Exactly 5 canonical Markdown files exist in content/fashion-knowledge/.
 * 2. Each file is properly structured with a top-level title and multiple '## ' chunk sections.
 * 3. Chunks are dense, informative, and strictly fashion-scoped.
 * 4. Zero tourist/travel/non-fashion general knowledge leakage.
 */

import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const CORPUS_DIR = path.resolve(process.cwd(), 'content/fashion-knowledge');

const EXPECTED_FILES = [
  'dress-codes.md',
  'egyptian-regional-norms.md',
  'color-theory.md',
  'silhouette-layering.md',
  'fabric-seasonality.md',
];

describe('Phase 15D Step 1 — Fashion Knowledge Corpus', () => {
  it('contains all 5 canonical Markdown files', () => {
    expect(fs.existsSync(CORPUS_DIR)).toBe(true);
    const files = fs.readdirSync(CORPUS_DIR);
    for (const expected of EXPECTED_FILES) {
      expect(files).toContain(expected);
    }
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(5);
  });

  it('each file contains a title (#) and at least 4 chunk headings (##)', () => {
    for (const fileName of EXPECTED_FILES) {
      const filePath = path.join(CORPUS_DIR, fileName);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Top level title
      expect(content).toMatch(/^#\s+[^\n]+/m);

      // Extract ## chunk sections
      const headings = content.match(/^##\s+[^\n]+/gm) || [];
      expect(headings.length).toBeGreaterThanOrEqual(4);

      // Verify each section has non-trivial body text
      const sections = content.split(/^##\s+/m).slice(1);
      for (const section of sections) {
        expect(section.trim().length).toBeGreaterThan(100);
      }
    }
  });

  it('contains strictly fashion, styling, textile, and dress-code terminology', () => {
    const requiredFashionTerms = [
      'tuxedo',
      'gown',
      'suit',
      'blazer',
      'linen',
      'footwear',
      'proportions',
      'neutral',
    ];

    const allContent = EXPECTED_FILES.map((fileName) =>
      fs.readFileSync(path.join(CORPUS_DIR, fileName), 'utf-8').toLowerCase()
    ).join(' ');

    for (const term of requiredFashionTerms) {
      expect(allContent).toContain(term);
    }
  });

  it('strictly excludes non-fashion travel/tourism general content', () => {
    const forbiddenOffTopicTerms = [
      'pyramids of giza',
      'valley of the kings',
      'museum opening hours',
      'airport taxi fare',
      'nile cruise booking',
      'currency exchange rates',
    ];

    const allContent = EXPECTED_FILES.map((fileName) =>
      fs.readFileSync(path.join(CORPUS_DIR, fileName), 'utf-8').toLowerCase()
    ).join(' ');

    for (const forbidden of forbiddenOffTopicTerms) {
      expect(allContent).not.toContain(forbidden);
    }
  });
});
