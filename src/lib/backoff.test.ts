import { describe, expect, it } from 'vitest';
import { RETRY_BASE_MS, RETRY_MAX_MS, isRetryDue, retryDelayMs } from './backoff';

const MINUTE = 60_000;

describe('retryDelayMs', () => {
  it('starts at five minutes and doubles', () => {
    expect(retryDelayMs(0)).toBe(5 * MINUTE);
    expect(retryDelayMs(1)).toBe(5 * MINUTE);
    expect(retryDelayMs(2)).toBe(10 * MINUTE);
    expect(retryDelayMs(3)).toBe(20 * MINUTE);
    expect(retryDelayMs(4)).toBe(40 * MINUTE);
    expect(retryDelayMs(7)).toBe(320 * MINUTE);
  });

  it('never exceeds the six-hour cap', () => {
    expect(retryDelayMs(8)).toBe(RETRY_MAX_MS);
    expect(retryDelayMs(99)).toBe(RETRY_MAX_MS);
    expect(RETRY_MAX_MS).toBe(6 * 60 * MINUTE);
  });

  it('has a sane base', () => {
    expect(RETRY_BASE_MS).toBe(5 * MINUTE);
  });
});

describe('isRetryDue', () => {
  it('treats a missing nextRetryAt as due', () => {
    expect(isRetryDue({}, 1_000)).toBe(true);
  });

  it('is due at or after the timestamp', () => {
    expect(isRetryDue({ nextRetryAt: 999 }, 1_000)).toBe(true);
    expect(isRetryDue({ nextRetryAt: 1_000 }, 1_000)).toBe(true);
    expect(isRetryDue({ nextRetryAt: 1_001 }, 1_000)).toBe(false);
  });
});
