import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Global asynchronous request context store.
 * Holds request correlation metadata across asynchronous execution chains
 * without requiring manual argument threading through services or models.
 */
export const requestContext = new AsyncLocalStorage();

/**
 * Returns the current request ID from AsyncLocalStorage, or undefined if outside request context.
 * @returns {string|undefined}
 */
export const getRequestId = () => {
  return requestContext.getStore()?.requestId;
};

export default requestContext;
