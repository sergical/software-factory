import { describe, expect, it } from "vitest";
import { newId } from "./id";

describe("newId", () => {
  it("returns a non-empty string", () => {
    expect(newId().length).toBeGreaterThan(0);
  });

  it("generates unique ids", () => {
    const ids = Array.from({ length: 10 }, () => newId());
    expect(new Set(ids).size).toBe(10);
  });
});
