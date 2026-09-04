import {
  quoteBinaryStakeOverBook,
  type BinaryBuySide,
  type BinaryOrderBook,
} from "@somnia-chain/markets-sdk";
import type { BookConstraints } from "../core/units.js";

export function selectedOutcomePrice(
  side: BinaryBuySide,
  yesPrice: bigint,
  priceScale: bigint,
) {
  return side === "BUY_YES" ? yesPrice : priceScale - yesPrice;
}

export function buildCallQuote(input: {
  stake: bigint;
  side: BinaryBuySide;
  book: BinaryOrderBook;
  constraints: BookConstraints;
}) {
  const quote = quoteBinaryStakeOverBook(
    input.book,
    input.side,
    input.stake,
    input.constraints.priceScale,
    input.constraints,
  );
  if (!quote) {
    throw new Error("This stake cannot fill the selected side at the live market depth.");
  }
  return {
    yesPrice: quote.yesPrice,
    limitPrice: quote.limitPrice,
    quantity: quote.quantity,
    maximumCost: quote.escrow,
    possiblePayout: quote.quantity,
  };
}
