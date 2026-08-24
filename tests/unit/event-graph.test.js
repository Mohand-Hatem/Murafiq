import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Static guard against the class of bug found in the post-hardening review: a listener
 * subscribed to an event nothing emits (silently dead — e.g. an admin action with no
 * audited effect) is a much easier mistake to make than a typo'd EVENTS.* key (which
 * events.constant.test.js already catches), because both sides type-check individually.
 *
 * This scans the real source tree rather than importing modules, so it catches drift
 * regardless of which files happen to be required by the test run.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '../../src');

// Domain events that are intentionally emit-only right now — nothing subscribes yet, and
// that's a forward-looking hook, not a bug. Keep this list short and reviewed; every entry
// is a deliberate exception, not a place to silently accumulate orphans.
const ALLOWED_EMIT_WITHOUT_LISTENER = new Set([
  'BOOKING_CREATED', // reserved for a future booking-created listener (e.g. analytics)
  'SESSION_DISPUTED', // superseded by DISPUTE_RAISED, kept for external/webhook consumers
  'USER_REGISTERED', // reserved for a future welcome-sequence listener
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function collectEventNames(pattern) {
  const names = new Set();
  for (const file of walk(SRC_DIR)) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const match of content.matchAll(pattern)) {
      names.add(match[1]);
    }
  }
  return names;
}

describe('Domain event graph — every listener has an emitter', () => {
  it('has no eventBus.on(EVENTS.X) with zero corresponding eventBus.emit(EVENTS.X) in src/', () => {
    // Matches both `emit(EVENTS.X` and the ternary form `emit(cond ? EVENTS.X : EVENTS.Y`
    const emitted = collectEventNames(/EVENTS\.([A-Z_]+)[^)]*?(?=,|\))/g);
    // Restrict to only names that appear as the argument of an actual .emit( call somewhere
    // on the same line/expression — the broad regex above over-collects, so re-derive emitted
    // names strictly from lines containing '.emit('.
    const emittedStrict = new Set();
    for (const file of walk(SRC_DIR)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.includes('.emit(')) continue;
        for (const match of line.matchAll(/EVENTS\.([A-Z_]+)/g)) {
          emittedStrict.add(match[1]);
        }
      }
    }
    void emitted; // broad set unused directly; kept for readability of intent above

    const listened = new Set();
    for (const file of walk(SRC_DIR)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.includes('.on(')) continue;
        const match = line.match(/EVENTS\.([A-Z_]+)/);
        if (match) listened.add(match[1]);
      }
    }

    const danglingListeners = [...listened].filter((name) => !emittedStrict.has(name));

    expect(danglingListeners).toEqual([]);
  });

  it('flags every emitted event with no listener, for visibility (not a failure by itself)', () => {
    const emittedStrict = new Set();
    const listened = new Set();
    for (const file of walk(SRC_DIR)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split('\n')) {
        if (line.includes('.emit(')) {
          for (const match of line.matchAll(/EVENTS\.([A-Z_]+)/g)) {
            emittedStrict.add(match[1]);
          }
        }
        if (line.includes('.on(')) {
          const match = line.match(/EVENTS\.([A-Z_]+)/);
          if (match) listened.add(match[1]);
        }
      }
    }

    const emitOnly = [...emittedStrict].filter((name) => !listened.has(name));
    const unexpected = emitOnly.filter((name) => !ALLOWED_EMIT_WITHOUT_LISTENER.has(name));

    // Not asserting zero here on purpose — a new emit-only event is a normal, deliberate step
    // (build the emitter first, add the listener later). It must be added to the allow-list
    // above, though, so this test documents every case rather than silently accepting new ones.
    expect(unexpected).toEqual([]);
  });
});
