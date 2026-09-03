import type { Address, Hex } from "viem";
import { CoreValidationError } from "./errors.js";
import { assertFinalized } from "./guards.js";

export interface ClaimablePosition {
  marketId: Hex;
  outcome: 0 | 1;
  amount: bigint;
  estimatedPayout: bigint;
}

export interface RedemptionIntent extends ClaimablePosition {
  module: Address;
  outcomeToken: Address;
}

export function getClaimablePositions(input: {
  marketId: Hex;
  finalized: boolean;
  isResolved: boolean;
  isVoided: boolean;
  winningOutcome: number;
  payoutNumerators: readonly bigint[];
  payoutDenominator: bigint;
  balances: readonly [bigint, bigint];
}): ClaimablePosition[] {
  assertFinalized(input);
  if (input.payoutDenominator <= 0n) {
    throw new CoreValidationError("payout denominator must be positive");
  }
  if (input.payoutNumerators[0] === undefined || input.payoutNumerators[1] === undefined) {
    throw new CoreValidationError("settlement payout vector is incomplete");
  }
  const payoutNumerators: readonly [bigint, bigint] = [
    input.payoutNumerators[0],
    input.payoutNumerators[1],
  ];
  if (!input.isVoided) {
    if (input.winningOutcome !== 0 && input.winningOutcome !== 1) {
      throw new CoreValidationError("resolved market has an invalid winning outcome");
    }
    const winnerPayout = payoutNumerators[input.winningOutcome];
    const loserPayout = payoutNumerators[1 - input.winningOutcome];
    if (winnerPayout === undefined || winnerPayout <= 0n || loserPayout !== 0n) {
      throw new CoreValidationError("payout vector disagrees with the winning outcome");
    }
  }

  const candidates: ClaimablePosition[] = [];
  for (const outcome of [0, 1] as const) {
    const amount = input.balances[outcome];
    const numerator = payoutNumerators[outcome];
    const estimatedPayout = (amount * numerator) / input.payoutDenominator;
    if (amount > 0n && estimatedPayout > 0n) {
      candidates.push({
        marketId: input.marketId,
        outcome,
        amount,
        estimatedPayout,
      });
    }
  }
  if (candidates.length > 1 && !input.isVoided) {
    throw new CoreValidationError("resolved market has multiple payable outcomes");
  }
  return candidates;
}
