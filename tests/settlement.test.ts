import assert from "node:assert/strict";
import test from "node:test";
import { getClaimablePositions } from "../src/core/settlement.js";

const marketId = `0x${"2".repeat(64)}` as const;

test("returns only the payable resolved outcome", () => {
  const positions = getClaimablePositions({
    marketId,
    finalized: true,
    isResolved: true,
    isVoided: false,
    winningOutcome: 0,
    payoutNumerators: [10_000_000n, 0n],
    payoutDenominator: 10_000_000n,
    balances: [2_000_000n, 1_000_000n],
  });
  assert.deepEqual(positions, [{
    marketId,
    outcome: 0,
    amount: 2_000_000n,
    estimatedPayout: 2_000_000n,
  }]);
});

test("returns both payable positions for a void", () => {
  const positions = getClaimablePositions({
    marketId,
    finalized: true,
    isResolved: false,
    isVoided: true,
    winningOutcome: 0,
    payoutNumerators: [5_000_000n, 5_000_000n],
    payoutDenominator: 10_000_000n,
    balances: [2_000_000n, 1_000_000n],
  });
  assert.deepEqual(positions.map(({ outcome, estimatedPayout }) => ({
    outcome,
    estimatedPayout,
  })), [
    { outcome: 0, estimatedPayout: 1_000_000n },
    { outcome: 1, estimatedPayout: 500_000n },
  ]);
});

test("rejects incomplete settlement vectors", () => {
  assert.throws(() => getClaimablePositions({
    marketId,
    finalized: true,
    isResolved: true,
    isVoided: false,
    winningOutcome: 0,
    payoutNumerators: [10_000_000n],
    payoutDenominator: 10_000_000n,
    balances: [1n, 0n],
  }), /incomplete/);
});

test("rejects a payout vector that contradicts the winner", () => {
  assert.throws(() => getClaimablePositions({
    marketId,
    finalized: true,
    isResolved: true,
    isVoided: false,
    winningOutcome: 0,
    payoutNumerators: [0n, 10_000_000n],
    payoutDenominator: 10_000_000n,
    balances: [1n, 1n],
  }), /disagrees/);
});
