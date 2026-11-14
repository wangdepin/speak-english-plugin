'use strict';

const { SpeechError } = require('./errors.cjs');

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sends one request to a speech service and reads the whole response while the
 * timeout is still running. `read` turns the Response into the value to return.
 * A caller's own abort is rethrown untouched; a network failure or timeout
 * becomes a SpeechError.
 */
async function callService(service, url, init, read, options = {}) {
  const { fetchImpl = fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetchImpl(url, { ...init, signal: combined });
    return await read(response);
  } catch (error) {
    if (error instanceof SpeechError) throw error;
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new SpeechError(service, 'timeout', `${service} did not answer within ${timeoutMs} ms`);
    throw new SpeechError(service, 'unreachable', `${service} is unreachable`);
  }
}

/** A key must be one visible token: it travels in a request header. */
function requireKey(service, key) {
  if (typeof key !== 'string' || key.trim() === '') throw new SpeechError(service, 'missing-key', `no ${service} key is set`);
  if (!/^[\x21-\x7e]+$/.test(key)) throw new SpeechError(service, 'invalid-key', `the ${service} key contains spaces or control characters`);
  return key;
}

module.exports = { callService, requireKey, REQUEST_TIMEOUT_MS };
