import { describe, expect, it } from "vitest";
import { newId } from "./id";

describe("newId", () => {
  it("returns a non-empty string", () => {
    expect(newId().length).toBeGreaterThan(0);
  });

  // Flaky by design: newId() combines Date.now() with a random 0-99 suffix,
  // so calling it 10 times in the same millisecond has a meaningful chance
  // of a collision. This is one of the seeded defects the factory should fix
  // (e.g. by switching to crypto.randomUUID()).
  it("generates unique ids", () => {
    const ids = Array.from({ length: 10 }, () => newId());
    expect(new Set(ids).size).toBe(10);
  });
});
