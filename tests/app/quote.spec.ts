import { describe, expect, it } from "vitest";
import { buildCallQuote, selectedOutcomePrice } from "../../src/app/quote.js";

const constraints = {
  tickSize: 1_000n,
  lotSize: 1_000n,
  minQuantity: 1_000n,
  priceScale: 1_000_000n,
};

const upBook = {
  yesBids: [{ price: 300_000n, quantity: 20_000_000n }],
  yesAsks: [{ price: 399_000n, quantity: 20_000_000n }],
  noBids: [{ price: 601_000n, quantity: 20_000_000n }],
  noAsks: [{ price: 700_000n, quantity: 20_000_000n }],
};

const downBook = {
  yesBids: [{ price: 930_000n, quantity: 20_000_000n }],
  yesAsks: [{ price: 950_000n, quantity: 20_000_000n }],
  noBids: [{ price: 50_000n, quantity: 20_000_000n }],
  noAsks: [{ price: 70_000n, quantity: 20_000_000n }],
};

describe("call quote", () => {
  it("uses exact units and never exceeds the selected stake", () => {
    const quote = buildCallQuote({
      stake: 1_000_000n,
      side: "BUY_YES",
      book: upBook,
      constraints,
    });
    expect(quote.yesPrice).toBe(411_000n);
    expect(quote.limitPrice).toBe(411_000n);
    expect(quote.quantity).toBe(2_433_000n);
    expect(quote.maximumCost).toBe(999_963n);
    expect(quote.possiblePayout).toBe(2_433_000n);
  });

  it("converts a DOWN quote into the YES-price encoding required by the pool", () => {
    const quote = buildCallQuote({
      stake: 1_000_000n,
      side: "BUY_NO",
      book: downBook,
      constraints,
    });
    expect(quote.limitPrice).toBe(80_000n);
    expect(quote.yesPrice).toBe(920_000n);
    expect(quote.quantity).toBe(12_500_000n);
    expect(quote.maximumCost).toBe(1_000_000n);
  });

  it("presents raw YES fill prices in the selected outcome frame", () => {
    expect(selectedOutcomePrice("BUY_YES", 920_000n, constraints.priceScale)).toBe(920_000n);
    expect(selectedOutcomePrice("BUY_NO", 920_000n, constraints.priceScale)).toBe(80_000n);
  });

  it("refuses an order below the live pool minimum", () => {
    expect(() => buildCallQuote({
      stake: 1n,
      side: "BUY_YES",
      book: upBook,
      constraints,
    })).toThrow(/cannot fill/);
  });
});
