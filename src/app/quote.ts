import type { BookConstraints } from "../core/units.js";
import { floorToIncrement, maximumBuyCost } from "../core/units.js";

export function buildCallQuote(input: {
  stake: bigint;
  bestAsk: bigint;
  constraints: BookConstraints;
}) {
  const { stake, bestAsk, constraints } = input;
  const protection = constraints.tickSize > constraints.priceScale / 100n
    ? constraints.tickSize
    : constraints.priceScale / 100n;
  const limitPrice = bestAsk + protection < constraints.priceScale
    ? bestAsk + protection
    : bestAsk;
  const rawQuantity = (stake * constraints.priceScale) / limitPrice;
  const quantity = floorToIncrement(rawQuantity, constraints.lotSize);
  if (quantity < constraints.minQuantity) {
    throw new Error("Stake is too small for this market's minimum order.");
  }
  const maximumCost = maximumBuyCost(limitPrice, quantity, constraints.priceScale);
  if (maximumCost > stake) throw new Error("Calculated maximum loss exceeds the stake.");
  return { limitPrice, quantity, maximumCost, possiblePayout: quantity };
}
