import { describe, expect, it } from "vitest";
import { formatUnits, parseDecimalUnits } from "../../src/app/amounts.js";

describe("display amounts", () => {
  it("parses decimal strings without floating point", () => {
    expect(parseDecimalUnits("12.3456", 6)).toBe(12_345_600n);
    expect(formatUnits(12_345_600n, 6)).toBe("12.34");
  });

  it("rejects excess precision and zero", () => {
    expect(() => parseDecimalUnits("1.0000001", 6)).toThrow(/6 decimal/);
    expect(() => parseDecimalUnits("0", 6)).toThrow(/greater than zero/);
  });
});
