import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./id";

describe("newId", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a non-empty string", () => {
    expect(newId().length).toBeGreaterThan(0);
  });

  // With the clock frozen, a timestamp-plus-random-0-99-suffix generator can
  // produce at most 100 distinct ids, so generating 101 in the same
  // "millisecond" deterministically fails for that implementation.
  // crypto.randomUUID() must keep every id unique regardless of time.
  it("generates unique ids even when created at the same instant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const count = 101;
    const ids = Array.from({ length: count }, () => newId());
    expect(new Set(ids).size).toBe(count);
  });
});
