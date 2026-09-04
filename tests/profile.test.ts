import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import {
  formatRational,
  reconcileProfile,
  type MarketEvidence,
  type ProfileFill,
} from "../src/core/profile.js";

const account = "0x1111111111111111111111111111111111111111" as Address;
const collateral = "0x2222222222222222222222222222222222222222" as Address;
const marketId = (value: string) => `0x${value.repeat(64)}` as Hex;

function market(id: Hex, winner: 0 | 1 | null, voided = false): MarketEvidence {
  return {
    marketId: id,
    question: "BTC closes at or above its opening price",
    collateral,
    decimals: 6,
    quantityDecimals: 6,
    finalized: true,
    voided,
    winningOutcome: winner,
    payoutNumerators: voided ? [5_000_000n, 5_000_000n] : winner === null
      ? null
      : winner === 0 ? [10_000_000n, 0n] : [0n, 10_000_000n],
    payoutDenominator: winner === null && !voided ? null : 10_000_000n,
    settlementTransactionHash: `0x${"a".repeat(64)}`,
    oracleTransactionHash: `0x${"b".repeat(64)}`,
  };
}

function fill(overrides: Partial<ProfileFill> = {}): ProfileFill {
  return {
    id: "100_1",
    marketId: marketId("1"),
    transactionHash: `0x${"c".repeat(64)}`,
    timestampSec: 100n,
    blockNumber: 100n,
    logIndex: 1,
    orderId: 7n,
    side: "BUY_YES",
    yesPrice: 400_000n,
    quantity: 1_000_000n,
    ...overrides,
  };
}

test("matches the approved CYS-EDGE-v1 vectors", () => {
  const secondMarket = marketId("2");
  const profile = reconcileProfile({
    account,
    fills: [
      fill(),
      fill({ id: "200_1", marketId: secondMarket, timestampSec: 200n, blockNumber: 200n, orderId: 8n, yesPrice: 800_000n }),
    ],
    markets: new Map([
      [marketId("1").toLowerCase(), market(marketId("1"), 0)],
      [secondMarket.toLowerCase(), market(secondMarket, 1)],
    ]),
  });
  assert.equal(formatRational(profile.rounds[1]!.roundPoints!), "60.00");
  assert.equal(formatRational(profile.rounds[0]!.roundPoints!), "-80.00");
  assert.equal(formatRational(profile.skillScore!), "45.00");
  assert.equal(profile.totalReturnRaw, -200_000n);
  assert.equal(profile.maximumDrawdownRaw, 800_000n);
  assert.equal(formatRational(profile.accuracy!), "0.50");
});

test("aggregates partial fills and locks the first order", () => {
  const id = marketId("3");
  const duplicate = fill({ id: "300_1", marketId: id, timestampSec: 300n, orderId: 9n });
  const profile = reconcileProfile({
    account,
    fills: [
      duplicate,
      duplicate,
      fill({ id: "300_2", marketId: id, timestampSec: 301n, blockNumber: 301n, logIndex: 2, orderId: 9n, yesPrice: 600_000n, quantity: 3_000_000n }),
      fill({ id: "300_3", marketId: id, timestampSec: 302n, blockNumber: 302n, logIndex: 3, orderId: 10n, side: "BUY_NO", yesPrice: 100_000n }),
    ],
    markets: new Map([[id.toLowerCase(), market(id, 0)]]),
  });
  assert.equal(profile.rounds.length, 1);
  assert.equal(profile.rounds[0]!.quantity, 4_000_000n);
  assert.equal(formatRational(profile.rounds[0]!.confidence), "0.55");
  assert.equal(formatRational(profile.rounds[0]!.roundPoints!), "45.00");
});

test("converts YES contract prices into selected NO confidence", () => {
  const id = marketId("4");
  const profile = reconcileProfile({
    account,
    fills: [fill({ marketId: id, side: "BUY_NO", yesPrice: 700_000n })],
    markets: new Map([[id.toLowerCase(), market(id, 1)]]),
  });
  assert.equal(formatRational(profile.rounds[0]!.confidence), "0.30");
  assert.equal(formatRational(profile.rounds[0]!.roundPoints!), "70.00");
});

test("keeps void and pending rounds visible but out of profile statistics", () => {
  const voidId = marketId("5");
  const pendingId = marketId("6");
  const pending = { ...market(pendingId, null), finalized: false };
  const profile = reconcileProfile({
    account,
    fills: [
      fill({ marketId: voidId }),
      fill({ id: "101_1", marketId: pendingId, timestampSec: 101n, blockNumber: 101n }),
    ],
    markets: new Map([
      [voidId.toLowerCase(), market(voidId, null, true)],
      [pendingId.toLowerCase(), pending],
    ]),
  });
  assert.equal(profile.settledCount, 0);
  assert.equal(profile.state, "empty");
  assert.deepEqual(profile.rounds.map((round) => round.state), ["pending", "void"]);
});

test("uses half-up display rounding", () => {
  assert.equal(formatRational({ numerator: 1n, denominator: 8n }, 2), "0.13");
  assert.equal(formatRational({ numerator: -1n, denominator: 8n }, 2), "-0.13");
});

test("uses the fee-scaled settlement payout for return without changing skill", () => {
  const id = marketId("7");
  const evidence = {
    ...market(id, 0),
    payoutNumerators: [9_900_000n, 0n],
  };
  const profile = reconcileProfile({
    account,
    fills: [fill({ marketId: id })],
    markets: new Map([[id.toLowerCase(), evidence]]),
  });
  assert.equal(formatRational(profile.rounds[0]!.roundPoints!), "60.00");
  assert.equal(profile.rounds[0]!.payoutRaw, 990_000n);
  assert.equal(profile.rounds[0]!.returnRaw, 590_000n);
});

test("makes ten settled calls verified and lets voids pass through a win streak", () => {
  const fills = Array.from({ length: 11 }, (_, index) => fill({
    id: `${500 + index}_1`,
    marketId: marketId(index.toString(16)),
    timestampSec: BigInt(500 + index),
    blockNumber: BigInt(500 + index),
    orderId: BigInt(20 + index),
  }));
  const markets = new Map(fills.map((item, index) => [
    item.marketId.toLowerCase(),
    index === 1 ? market(item.marketId, null, true) : market(item.marketId, index === 2 ? 1 : 0),
  ]));
  const profile = reconcileProfile({ account, fills, markets });
  assert.equal(profile.state, "verified");
  assert.equal(profile.settledCount, 10);
  assert.equal(profile.wins, 9);
  assert.equal(profile.bestStreak, 8);
  assert.equal(profile.currentStreak, 8);
});
