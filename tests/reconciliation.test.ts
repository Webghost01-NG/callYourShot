import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import {
  DreamDexProfileReconciler,
  type IndexedProfileFill,
  type IndexedProfileMarket,
  type OnchainProfileMarket,
  type ProfileEvidenceClient,
  type ProfileSettlement,
} from "../src/dreamdex/reconciliation.js";

const account = "0x1111111111111111111111111111111111111111" as Address;
const collateral = "0x2222222222222222222222222222222222222222" as Address;
const pool = "0x3333333333333333333333333333333333333333" as Address;
const marketId = `0x${"4".repeat(64)}` as Hex;
const venueId = `0x${"5".repeat(64)}` as Hex;
const fillHash = `0x${"6".repeat(64)}` as Hex;
const settlementHash = `0x${"7".repeat(64)}` as Hex;
const oracleHash = `0x${"8".repeat(64)}` as Hex;

function fill(overrides: Partial<IndexedProfileFill> = {}): IndexedProfileFill {
  return {
    id: "100_1",
    market: marketId,
    fillPrice: "400000",
    quantity: "1000000",
    maker: account,
    makerSide: "BUY_YES",
    taker: null,
    takerSide: null,
    takerOrder: null,
    makerOrderId: "7",
    takerOrderId: "8",
    timestamp: "100",
    txHash: fillHash,
    ...overrides,
  };
}

function indexedMarket(overrides: Partial<IndexedProfileMarket> = {}): IndexedProfileMarket {
  return {
    marketId,
    marketType: "BINARY",
    asset: "BTC",
    question: "BTC closes at or above its opening price",
    baseDecimals: 6,
    quoteDecimals: 6,
    collateral,
    poolAddress: pool,
    intervalSec: "900",
    operatorId: 2,
    venueId,
    ...overrides,
  };
}

function onchain(overrides: Partial<OnchainProfileMarket> = {}): OnchainProfileMarket {
  return {
    collateral,
    pool,
    decimals: 6,
    finalized: true,
    isResolved: true,
    isVoided: false,
    winningOutcome: 0,
    ...overrides,
  };
}

function settlement(): ProfileSettlement {
  return {
    collateralToken: collateral,
    pool,
    finalized: true,
    voided: false,
    winningOutcome: 0,
    payoutNumerators: [10_000_000n, 0n],
  };
}

function client(rows: IndexedProfileFill[], overrides: Partial<ProfileEvidenceClient> = {}): ProfileEvidenceClient {
  return {
    getUserFills: async (_account, options) => rows.slice(options.offset, options.offset + options.limit),
    getBinaryMarket: async () => indexedMarket(),
    getMarketOnchain: async () => onchain(),
    getMarketResolution: async () => ({ events: [], closingAnswer: { txHash: oracleHash } }),
    getMarketStatusHistory: async () => [{ newStatus: "Finalized", blockNumber: "900", txHash: settlementHash }],
    ...overrides,
  };
}

const criteria = {
  asset: "BTC",
  intervalSec: 900,
  origin: { operatorId: 2, venueId },
};

test("rebuilds a scored profile from fill, settlement, and oracle evidence", async () => {
  const reconciler = new DreamDexProfileReconciler(client([fill()]), async () => settlement(), undefined, () => 1_000n);
  const result = await reconciler.reconcile(account, criteria);
  assert.equal(result.snapshotTimestampSec, 1_000n);
  assert.equal(result.sourceBlock, 900n);
  assert.equal(result.profile.settledCount, 1);
  assert.equal(result.profile.wins, 1);
  assert.equal(result.profile.rounds[0]!.state, "won");
  assert.equal(result.profile.rounds[0]!.fillTransactionHash, fillHash);
  assert.equal(result.profile.rounds[0]!.settlementTransactionHash, settlementHash);
  assert.equal(result.profile.rounds[0]!.oracleTransactionHash, oracleHash);
  assert.deepEqual(result.evidenceGaps, []);
});

test("paginates the complete fill history before choosing a first buy", async () => {
  const sells = Array.from({ length: 200 }, (_, index) => fill({
    id: `${100 + index}_${index}`,
    makerSide: "SELL_YES",
    timestamp: `${100 + index}`,
  }));
  const offsets: number[] = [];
  const source = client([...sells, fill({ id: "400_1", timestamp: "400" })], {
    getUserFills: async (_account, options) => {
      offsets.push(options.offset);
      return [...sells, fill({ id: "400_1", timestamp: "400" })]
        .slice(options.offset, options.offset + options.limit);
    },
  });
  const result = await new DreamDexProfileReconciler(source, async () => settlement()).reconcile(account, criteria);
  assert.deepEqual(offsets, [0, 200]);
  assert.equal(result.profile.rounds.length, 1);
});

test("does not count a supported market when any fill attribution is incomplete", async () => {
  const incomplete = fill({ makerSide: null });
  const result = await new DreamDexProfileReconciler(
    client([incomplete]),
    async () => settlement(),
  ).reconcile(account, criteria);
  assert.equal(result.profile.rounds.length, 0);
  assert.equal(result.evidenceGaps[0]?.kind, "fill");
});

test("keeps chain-verified scores while reporting a missing oracle link", async () => {
  const source = client([fill()], {
    getMarketResolution: async () => ({ events: [], closingAnswer: null }),
  });
  const result = await new DreamDexProfileReconciler(source, async () => settlement()).reconcile(account, criteria);
  assert.equal(result.profile.settledCount, 1);
  assert.equal(result.profile.rounds[0]!.oracleTransactionHash, null);
  assert.equal(result.evidenceGaps[0]?.kind, "oracle");
});

test("finds the module finalization event when the indexer reports only Resolved", async () => {
  const finalizationHash = `0x${"9".repeat(64)}` as Hex;
  const source = client([fill()], {
    getMarketStatusHistory: async () => [{
      newStatus: "Resolved",
      blockNumber: "321",
      txHash: settlementHash,
    }],
  });
  const reads: Array<{ marketId: Hex; blockNumber: bigint }> = [];
  const result = await new DreamDexProfileReconciler(
    source,
    async () => settlement(),
    async (id, blockNumber) => {
      reads.push({ marketId: id, blockNumber });
      return finalizationHash;
    },
  ).reconcile(account, criteria);

  assert.deepEqual(reads, [{ marketId, blockNumber: 321n }]);
  assert.equal(result.profile.rounds[0]!.settlementTransactionHash, finalizationHash);
  assert.equal(result.evidenceGaps.some((gap) => gap.kind === "finalization"), false);
});

test("shows an unfinalized filled round without reading permanent settlement", async () => {
  let settlementReads = 0;
  const source = client([fill()], { getMarketOnchain: async () => onchain({ finalized: false, isResolved: false }) });
  const result = await new DreamDexProfileReconciler(source, async () => {
    settlementReads += 1;
    return settlement();
  }).reconcile(account, criteria);
  assert.equal(settlementReads, 0);
  assert.equal(result.profile.rounds[0]!.state, "pending");
});

test("uses the configured-series list when the exact market lookup is unavailable", async () => {
  const source = client([fill()], {
    getBinaryMarket: async () => { throw new Error("exact lookup timed out"); },
    listPastBinaryMarkets: async () => [indexedMarket()],
  });
  const result = await new DreamDexProfileReconciler(source, async () => settlement()).reconcile(account, criteria);
  assert.equal(result.profile.settledCount, 1);
  assert.equal(result.evidenceGaps.length, 0);
});

test("excludes fills before a server-authoritative league enrollment time", async () => {
  const rows = [
    fill({ id: "100_1", timestamp: "100", makerOrderId: "5" }),
    fill({ id: "200_1", timestamp: "200", makerOrderId: "7" }),
  ];
  const result = await new DreamDexProfileReconciler(client(rows), async () => settlement())
    .reconcile(account, { ...criteria, minimumTimestampSec: 150n });
  assert.equal(result.profile.rounds.length, 1);
  assert.equal(result.profile.rounds[0]!.timestampSec, 200n);
});

test("reconciles every binary asset and cadence from the trusted origin when filters are omitted", async () => {
  const ethMarketId = `0x${"9".repeat(64)}` as Hex;
  const markets = new Map([
    [marketId.toLowerCase(), indexedMarket()],
    [ethMarketId.toLowerCase(), indexedMarket({
      marketId: ethMarketId,
      asset: "ETH",
      question: "ETH closes at or above its opening price",
      intervalSec: "300",
    })],
  ]);
  const rows = [fill(), fill({
    id: "200_1",
    market: ethMarketId,
    timestamp: "200",
    makerOrderId: "9",
  })];
  const source = client(rows, {
    getBinaryMarket: async (id) => markets.get(id.toLowerCase()) ?? null,
  });
  const result = await new DreamDexProfileReconciler(source, async () => settlement())
    .reconcile(account, { origin: criteria.origin });
  assert.deepEqual(result.profile.rounds.map((round) => round.question).sort(), [
    "BTC closes at or above its opening price",
    "ETH closes at or above its opening price",
  ]);
});

test("still excludes markets from an untrusted origin in multi-market mode", async () => {
  const source = client([fill()], {
    getBinaryMarket: async () => indexedMarket({ operatorId: 99 }),
  });
  const result = await new DreamDexProfileReconciler(source, async () => settlement())
    .reconcile(account, { origin: criteria.origin });
  assert.equal(result.profile.rounds.length, 0);
});
