import EventEmitter from 'events';

const createEventBus = () => {
  const bus = new EventEmitter();
  bus.setMaxListeners(30);

  // Unlike emit(), runs every listener for `event` and waits for all of them, resolving to the
  // errors of the ones that threw, rejected or did not settle within timeoutMs. A listener that
  // fails never stops the others. Used where the caller must know the side effects succeeded
  // (SESSION_COMPLETED, via booking.service.js finalizeCompletion).
  bus.emitAndWait = async (event, payload, { timeoutMs } = {}) => {
    const all = Promise.allSettled(bus.listeners(event).map((fn) => Promise.resolve().then(() => fn(payload))));
    let timer;
    const timeout = timeoutMs
      ? new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        })
      : null;
    const settled = await (timeout ? Promise.race([all, timeout]) : all);
    clearTimeout(timer);
    if (!settled) return [new Error(`${event} listeners timed out after ${timeoutMs}ms`)];
    return settled.filter((r) => r.status === 'rejected').map((r) => r.reason);
  };

  return bus;
};

const eventBus = createEventBus();
export default eventBus;
