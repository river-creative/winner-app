import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, batchSave } from './client';

/**
 * How a failed request is classified.
 *
 * This exists because of a defect found by driving the real app: a draw whose write ran past its
 * deadline reported "The draw failed. The user aborted a request." while the server had saved it
 * in full — winners, history, the prize decrement, all of it — and the operator was left with no
 * undo and an invitation to draw the same prize again.
 *
 * The cause was that a deadline can fire at two different points. `fetch` rejects if the request
 * is still in flight; the *body read* rejects if the response had already started streaming. Only
 * the first was guarded, so the second escaped unclassified. Both are covered here.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Chrome rejects `fetch` with the signal's reason: a DOMException named `TimeoutError`. */
function timeoutError(): Error {
  const error = new Error('signal timed out');
  error.name = 'TimeoutError';
  return error;
}

/** A body read cancelled by that same signal rejects with a plain `AbortError` instead. */
function abortError(): Error {
  const error = new Error('The user aborted a request.');
  error.name = 'AbortError';
  return error;
}

describe('request error classification', () => {
  it('marks a deadline that fires during the request as timed out', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(timeoutError());

    const error = await batchSave([]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).timedOut).toBe(true);
    expect((error as ApiError).message).toBe('The server did not answer in time.');
  });

  it('marks a deadline that fires while the body is read as timed out', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.reject(abortError())
    } as unknown as Response);

    const error = await batchSave([]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    // The whole point: this used to escape as a raw DOMException and be reported as a draw that
    // failed and saved nothing.
    expect((error as ApiError).timedOut).toBe(true);
  });

  it('does not mark an unreachable server as timed out', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await batchSave([]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).timedOut).toBe(false);
    expect((error as ApiError).message).toBe('Cannot reach the server. Please check your connection.');
  });

  it('does not mark a rejected write as timed out', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: 'List x does not exist.' }))
    } as unknown as Response);

    const error = await batchSave([]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).timedOut).toBe(false);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe('List x does not exist.');
  });

  it('only attaches a deadline when one is asked for', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"results":[],"writeResults":{}}')
    } as unknown as Response);
    globalThis.fetch = spy;

    await batchSave([]);
    expect(spy.mock.calls[0]?.[1]?.signal).toBeUndefined();

    await batchSave([], 5000);
    expect(spy.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
