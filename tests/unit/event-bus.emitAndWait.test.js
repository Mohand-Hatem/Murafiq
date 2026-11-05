import { describe, it, expect, afterEach } from '@jest/globals';
import eventBus from '../../src/common/events/event-bus.js';

const EVENT = 'test.emit_and_wait';

describe('eventBus.emitAndWait', () => {
  afterEach(() => eventBus.removeAllListeners(EVENT));

  it('waits for every listener and returns the errors of the ones that failed', async () => {
    const seen = [];
    eventBus.on(EVENT, async (p) => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push(`slow:${p.n}`);
    });
    eventBus.on(EVENT, () => {
      throw new Error('sync failure');
    });
    eventBus.on(EVENT, async () => {
      throw new Error('async failure');
    });
    eventBus.on(EVENT, (p) => seen.push(`sync:${p.n}`));

    const failures = await eventBus.emitAndWait(EVENT, { n: 1 });

    expect(seen.sort()).toEqual(['slow:1', 'sync:1']);
    expect(failures.map((e) => e.message).sort()).toEqual(['async failure', 'sync failure']);
  });

  it('returns no failures when there are no listeners', async () => {
    expect(await eventBus.emitAndWait(EVENT, {})).toEqual([]);
  });

  it('reports a timeout when a listener never settles', async () => {
    eventBus.on(EVENT, () => new Promise(() => {}));

    const failures = await eventBus.emitAndWait(EVENT, {}, { timeoutMs: 30 });

    expect(failures).toHaveLength(1);
    expect(failures[0].message).toMatch(/timed out after 30ms/);
  });
});
