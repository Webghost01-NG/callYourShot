import { describe, expect, it } from "vitest";
import { buildCallQuote } from "../../src/app/quote.js";

const constraints = {
  tickSize: 1_000n,
  lotSize: 1_000n,
  minQuantity: 1_000n,
  priceScale: 1_000_000n,
};

describe("call quote", () => {
  it("uses exact units and never exceeds the selected stake", () => {
    const quote = buildCallQuote({
      stake: 1_000_000n,
      bestAsk: 399_000n,
      constraints,
    });
    expect(quote.limitPrice).toBe(409_000n);
    expect(quote.quantity).toBe(2_444_000n);
    expect(quote.maximumCost).toBe(999_596n);
    expect(quote.possiblePayout).toBe(2_444_000n);
  });

  it("refuses an order below the live pool minimum", () => {
    expect(() => buildCallQuote({
      stake: 1n,
      bestAsk: 500_000n,
      constraints,
    })).toThrow(/too small/);
  });
});
