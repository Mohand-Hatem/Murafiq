import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envConfigUrl = pathToFileURL(path.join(__dirname, '../../src/config/env.config.js')).href;
const MARKER = '__ENV_MODERATION_MODE__:';

// Regression guard for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X2: MODERATION_MODE was
// missing from the env.config.js Zod schema, so Zod's default object parsing silently
// stripped the key from `process.env` and `env.MODERATION_MODE` was always `undefined`
// regardless of what was actually set in the environment — meaning moderation enforcement
// could never leave DRY_RUN in production no matter how the deployment was configured.
//
// A unit test that only mutates the imported `env` object in-process (as
// moderation.service.test.js does) cannot catch this class of bug, because the mutation
// bypasses the exact code path that was broken — the Zod parse of `process.env`. This test
// runs env.config.js in a fresh child process with a real environment variable set, which is
// the only way to exercise that parse. Output is marker-prefixed because dotenv itself writes
// an informational banner to stdout on import.
describe('env.config.js — MODERATION_MODE schema wiring', () => {
  const runWithEnv = (moderationMode) => {
    const lines = [];
    lines.push("process.env.NODE_ENV = 'test';");
    if (moderationMode) {
      lines.push("process.env.MODERATION_MODE = '" + moderationMode + "';");
    }
    lines.push("const m = await import('" + envConfigUrl + "');");
    lines.push("console.log('" + MARKER + "' + JSON.stringify({ mode: m.default.MODERATION_MODE }));");
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', lines.join('\n')], {
      encoding: 'utf8',
    });
    const line = out.split('\n').find((l) => l.startsWith(MARKER));
    return JSON.parse(line.slice(MARKER.length));
  };

  it('resolves MODERATION_MODE=ENFORCE from a real environment variable', () => {
    const { mode } = runWithEnv('ENFORCE');
    expect(mode).toBe('ENFORCE');
  });

  it('defaults to DRY_RUN when the environment variable is unset', () => {
    const { mode } = runWithEnv(undefined);
    expect(mode).toBe('DRY_RUN');
  });
});
