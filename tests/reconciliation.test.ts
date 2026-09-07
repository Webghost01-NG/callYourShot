import assert from "node:assert/strict";
import test from "node:test";
import { orderBookEventsAbi } from "@somnia-chain/markets-sdk";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import {
  DreamDexProfileReconciler,
  type IndexedProfileOrder,
  type IndexedProfileFill,
  type IndexedProfileMarket,
  type OnchainProfileMarket,
  type ProfileChainEvidenceReader,
  type ProfileEvidenceClient,
  type ProfileSettlement,
  type ProfileTransactionLog,
  type ProfileTransactionReceipt,
} from "../src/dreamdex/reconciliation.js";

const account = "0x1111111111111111111111111111111111111111" as Address;
const collateral = "0x2222222222222222222222222222222222222222" as Address;
const pool = "0x3333333333333333333333333333333333333333" as Address;
const marketId = `0x${"4".repeat(64)}` as Hex;
const venueId = `0x${"5".repeat(64)}` as Hex;
const fillHash = `0x${"6".repeat(64)}` as Hex;
const settlementHash = `0x${"7".repeat(64)}` as Hex;
const oracleHash = `0x${"8".repeat(64)}` as Hex;
const placementHash = `0x${"a".repeat(64)}` as Hex;
const binaryOrderPlacedEvent = parseAbiItem(
  "event BinaryOrderPlaced(uint128 indexed orderId, uint8 kind)",
);

function generatedHash(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function fill(overrides: Partial<IndexedProfileFill> = {}): IndexedProfileFill {
  const result: IndexedProfileFill = {
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
  if (overrides.id && overrides.id !== "100_1" && overrides.txHash === undefined) {
    const [block, logIndex] = overrides.id.split("_").map(BigInt);
    result.txHash = generatedHash(block! * 1_000n + logIndex!);
  }
  return result;
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

function participant(row: IndexedProfileFill) {
  const maker = row.maker?.toLowerCase() === account.toLowerCase();
  return {
    role: maker ? "maker" as const : "taker" as const,
    orderId: BigInt(maker ? row.makerOrderId : row.takerOrderId),
    side: (maker ? row.makerSide : (row.takerOrder?.side ?? row.takerSide))!,
  };
}

function placementHashFor(row: IndexedProfileFill): Hex {
  const selected = participant(row);
  return selected.role === "taker"
    ? row.txHash as Hex
    : row.id === "100_1" ? placementHash : generatedHash(900_000n + selected.orderId);
}

function orderPlacedLogs(
  row: IndexedProfileFill,
  targetPool = pool,
  owner: Address = account,
): ProfileTransactionLog[] {
  const selected = participant(row);
  const blockNumber = selected.role === "taker"
    ? BigInt(row.id.split("_")[0]!)
    : 90n + selected.orderId;
  const transactionHash = placementHashFor(row);
  const orderPlacedTopics = encodeEventTopics({
    abi: orderBookEventsAbi,
    eventName: "OrderPlaced",
    args: { orderId: selected.orderId },
  });
  const orderPlacedData = encodeAbiParameters([{
    type: "tuple",
    components: [
      { name: "orderId", type: "uint128" },
      { name: "isBid", type: "bool" },
      { name: "owner", type: "address" },
      { name: "userData", type: "uint64" },
      { name: "price", type: "uint256" },
      { name: "fullQuantity", type: "uint256" },
      { name: "quantityRemaining", type: "uint256" },
      { name: "expireTimestampNs", type: "uint64" },
    ],
  }], [{
    orderId: selected.orderId,
    isBid: true,
    owner,
    userData: 0n,
    price: BigInt(row.fillPrice),
    fullQuantity: BigInt(row.quantity),
    quantityRemaining: 0n,
    expireTimestampNs: 1_000_000_000_000n,
  }]);
  const kind = selected.side === "BUY_YES" ? 0 : selected.side === "SELL_YES" ? 1
    : selected.side === "BUY_NO" ? 2 : 3;
  return [{
    address: targetPool,
    blockNumber,
    logIndex: 20,
    transactionHash,
    data: orderPlacedData,
    topics: orderPlacedTopics as unknown as ProfileTransactionLog["topics"],
  }, {
    address: targetPool,
    blockNumber,
    logIndex: 21,
    transactionHash,
    data: encodeAbiParameters([{ type: "uint8" }], [kind]),
    topics: encodeEventTopics({
      abi: [binaryOrderPlacedEvent],
      eventName: "BinaryOrderPlaced",
      args: { orderId: selected.orderId },
    }) as unknown as ProfileTransactionLog["topics"],
  }];
}

function fillLog(row: IndexedProfileFill, targetPool = pool): ProfileTransactionLog {
  const [block, logIndex] = row.id.split("_").map(Number);
  return {
    address: targetPool,
    blockNumber: BigInt(block!),
    logIndex: logIndex!,
    transactionHash: row.txHash as Hex,
    data: encodeAbiParameters([
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ], [BigInt(row.quantity), 0n, 0n, BigInt(row.fillPrice)]),
    topics: encodeEventTopics({
      abi: orderBookEventsAbi,
      eventName: "OrderFilled",
      args: {
        takerOrderId: BigInt(row.takerOrderId),
        makerOrderId: BigInt(row.makerOrderId),
      },
    }) as unknown as ProfileTransactionLog["topics"],
  };
}

function receipt(
  transactionHash: Hex,
  blockNumber: bigint,
  logs: ProfileTransactionLog[],
  status: ProfileTransactionReceipt["status"] = "success",
): ProfileTransactionReceipt {
  return { transactionHash, blockNumber, logs, status };
}

function indexedOrder(row: IndexedProfileFill, overrides: Partial<IndexedProfileOrder> = {}): IndexedProfileOrder {
  const selected = participant(row);
  return {
    orderId: selected.orderId.toString(),
    owner: account,
    side: selected.side,
    pool,
    market: row.market,
    placedTxHash: placementHashFor(row),
    placedAtBlock: (selected.role === "taker"
      ? BigInt(row.id.split("_")[0]!)
      : 90n + selected.orderId).toString(),
    ...overrides,
  };
}

function chainEvidence(
  rows: IndexedProfileFill[],
  overrides: Partial<ProfileChainEvidenceReader> = {},
): ProfileChainEvidenceReader {
  const receipts = new Map<string, ProfileTransactionReceipt>();
  for (const row of rows) {
    const selected = participant(row);
    if (selected.side?.startsWith("SELL")) continue;
    const fillBlock = BigInt(row.id.split("_")[0]!);
    const existingFillReceipt = receipts.get(row.txHash.toLowerCase());
    const fillReceiptLogs = [
      ...(existingFillReceipt?.logs ?? []),
      fillLog(row),
      ...(selected.role === "taker" && !existingFillReceipt ? orderPlacedLogs(row) : []),
    ];
    receipts.set(row.txHash.toLowerCase(), receipt(row.txHash as Hex, fillBlock, fillReceiptLogs));
    if (selected.role === "maker") {
      const hash = placementHashFor(row);
      const blockNumber = 90n + selected.orderId;
      if (!receipts.has(hash.toLowerCase())) {
        receipts.set(hash.toLowerCase(), receipt(hash, blockNumber, orderPlacedLogs(row)));
      }
    }
  }
  return {
    getTransactionReceipt: async (hash) => {
      const found = receipts.get(hash.toLowerCase());
      if (!found) throw new Error("receipt fixture unavailable");
      return found;
    },
    getBlockTimestamp: async (blockNumber) => blockNumber,
    ...overrides,
  };
}

function client(rows: IndexedProfileFill[], overrides: Partial<ProfileEvidenceClient> = {}): ProfileEvidenceClient {
  return {
    getUserFills: async (_account, options) => rows.slice(options.offset, options.offset + options.limit),
    getBinaryMarket: async () => indexedMarket(),
    getOrder: async (_pool, orderId) => {
      const row = rows.find((item) => participant(item).orderId === BigInt(orderId));
      return row ? indexedOrder(row) : null;
    },
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
  const rows = [fill()];
  const reconciler = new DreamDexProfileReconciler(
    client(rows),
    async () => settlement(),
    chainEvidence(rows),
    () => 1_000n,
  );
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
    makerOrderId: `${1_000 + index}`,
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
  const rows = [...sells, fill({ id: "400_1", timestamp: "400" })];
  const result = await new DreamDexProfileReconciler(
    source,
    async () => settlement(),
    chainEvidence(rows),
  ).reconcile(account, criteria);
  assert.deepEqual(offsets, [0, 200]);
  assert.equal(result.profile.rounds.length, 1);
});

test("does not count a supported market when any fill attribution is incomplete", async () => {
  const incomplete = fill({ makerSide: null });
  const result = await new DreamDexProfileReconciler(
    client([incomplete]),
    async () => settlement(),
    chainEvidence([incomplete]),
  ).reconcile(account, criteria);
  assert.equal(result.profile.rounds.length, 0);
  assert.equal(result.evidenceGaps[0]?.kind, "fill");
});

test("keeps chain-verified scores while reporting a missing oracle link", async () => {
  const source = client([fill()], {
    getMarketResolution: async () => ({ events: [], closingAnswer: null }),
  });
  const rows = [fill()];
  const result = await new DreamDexProfileReconciler(
    source,
    async () => settlement(),
    chainEvidence(rows),
  ).reconcile(account, criteria);
  assert.equal(result.profile.settledCount, 1);
  assert.equal(result.profile.rounds[0]!.oracleTransactionHash, null);
  assert.equal(result.evidenceGaps[0]?.kind, "oracle");
});

test("finds the module finalization event when the indexer reports only Resolved", async () => {
  const finalizationHash = `0x${"9".repeat(64)}` as Hex;
  const rows = [fill()];
  const source = client(rows, {
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
    chainEvidence(rows, {
      getFinalizationTransaction: async (id, blockNumber) => {
        reads.push({ marketId: id, blockNumber });
        return finalizationHash;
      },
    }),
  ).reconcile(account, criteria);

  assert.deepEqual(reads, [{ marketId, blockNumber: 321n }]);
  assert.equal(result.profile.rounds[0]!.settlementTransactionHash, finalizationHash);
  assert.equal(result.evidenceGaps.some((gap) => gap.kind === "finalization"), false);
});

test("shows an unfinalized filled round without reading permanent settlement", async () => {
  let settlementReads = 0;
  const rows = [fill()];
  const source = client(rows, { getMarketOnchain: async () => onchain({ finalized: false, isResolved: false }) });
  const result = await new DreamDexProfileReconciler(source, async () => {
    settlementReads += 1;
    return settlement();
  }, chainEvidence(rows)).reconcile(account, criteria);
  assert.equal(settlementReads, 0);
  assert.equal(result.profile.rounds[0]!.state, "pending");
});

test("uses the configured-series list when the exact market lookup is unavailable", async () => {
  const rows = [fill()];
  const source = client(rows, {
    getBinaryMarket: async () => { throw new Error("exact lookup timed out"); },
    listPastBinaryMarkets: async () => [indexedMarket()],
  });
  const result = await new DreamDexProfileReconciler(
    source,
    async () => settlement(),
    chainEvidence(rows),
  ).reconcile(account, criteria);
  assert.equal(result.profile.settledCount, 1);
  assert.equal(result.evidenceGaps.length, 0);
});

test("excludes fills before a server-authoritative league enrollment time", async () => {
  const rows = [
    fill({ id: "100_1", timestamp: "100", makerOrderId: "5" }),
    fill({ id: "200_1", timestamp: "200", makerOrderId: "7" }),
  ];
  const result = await new DreamDexProfileReconciler(
    client(rows),
    async () => settlement(),
    chainEvidence(rows),
  )
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
  const result = await new DreamDexProfileReconciler(
    source,
    async () => settlement(),
    chainEvidence(rows),
  )
    .reconcile(account, { origin: criteria.origin });
  assert.deepEqual(result.profile.rounds.map((round) => round.question).sort(), [
    "BTC closes at or above its opening price",
    "ETH closes at or above its opening price",
  ]);
});

test("still excludes markets from an untrusted origin in multi-market mode", async () => {
  const rows = [fill()];
  const source = client(rows, {
    getBinaryMarket: async () => indexedMarket({ operatorId: 99 }),
  });
  const result = await new DreamDexProfileReconciler(
    source,
    async () => settlement(),
    chainEvidence(rows),
  )
    .reconcile(account, { origin: criteria.origin });
  assert.equal(result.profile.rounds.length, 0);
});

async function reconcileWith(
  rows: IndexedProfileFill[],
  source = client(rows),
  evidence = chainEvidence(rows),
) {
  return new DreamDexProfileReconciler(source, async () => settlement(), evidence)
    .reconcile(account, criteria);
}

function mutateReceipt(
  rows: IndexedProfileFill[],
  mutate: (hash: Hex, value: ProfileTransactionReceipt) => ProfileTransactionReceipt,
): ProfileChainEvidenceReader {
  const base = chainEvidence(rows);
  return {
    ...base,
    getTransactionReceipt: async (hash) => mutate(hash, await base.getTransactionReceipt(hash)),
  };
}

const otherAccount = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const otherPool = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;

for (const scenario of [{
  name: "a reverted fill transaction",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({ ...value, status: "reverted" as const }),
}, {
  name: "a mismatched receipt transaction hash",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({
    ...value,
    transactionHash: generatedHash(88n),
  }),
}, {
  name: "a mismatched receipt block",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({
    ...value,
    blockNumber: value.blockNumber + 1n,
  }),
}, {
  name: "a missing exact log position",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({ ...value, logs: [] }),
}, {
  name: "a fill emitted by another pool",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({
    ...value,
    logs: [fillLog(row, otherPool)],
  }),
}, {
  name: "mismatched OrderFilled order IDs",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({
    ...value,
    logs: [fillLog({ ...row, makerOrderId: "99" })],
  }),
}, {
  name: "a mismatched OrderFilled quantity",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({
    ...value,
    logs: [fillLog({ ...row, quantity: "999999" })],
  }),
}, {
  name: "a mismatched OrderFilled price",
  mutate: (row: IndexedProfileFill, value: ProfileTransactionReceipt) => ({
    ...value,
    logs: [fillLog({ ...row, fillPrice: "400001" })],
  }),
}]) {
  test(`does not score ${scenario.name}`, async () => {
    const row = fill();
    const rows = [row];
    const evidence = mutateReceipt(rows, (hash, value) =>
      hash.toLowerCase() === fillHash.toLowerCase() ? scenario.mutate(row, value) : value
    );
    const result = await reconcileWith(rows, client(rows), evidence);
    assert.equal(result.profile.rounds.length, 0);
    assert.equal(result.evidenceGaps[0]?.kind, "fill");
    assert.match(result.evidenceGaps[0]?.message ?? "", /On-chain fill verification failed/);
  });
}

test("does not score an indexed order whose owner is not the profile wallet", async () => {
  const row = fill();
  const rows = [row];
  const source = client(rows, {
    getOrder: async () => indexedOrder(row, { owner: otherAccount }),
  });
  const result = await reconcileWith(rows, source);
  assert.equal(result.profile.rounds.length, 0);
  assert.match(result.evidenceGaps[0]?.message ?? "", /owner disagrees/);
});

test("does not score an indexed order whose side disagrees with the profile fill", async () => {
  const row = fill();
  const rows = [row];
  const source = client(rows, {
    getOrder: async () => indexedOrder(row, { side: "BUY_NO" }),
  });
  const result = await reconcileWith(rows, source);
  assert.equal(result.profile.rounds.length, 0);
  assert.match(result.evidenceGaps[0]?.message ?? "", /side disagrees/);
});

test("does not score when the order placement receipt proves another owner", async () => {
  const row = fill();
  const rows = [row];
  const evidence = mutateReceipt(rows, (hash, value) =>
    hash.toLowerCase() === placementHash.toLowerCase()
      ? { ...value, logs: orderPlacedLogs(row, pool, otherAccount) }
      : value
  );
  const result = await reconcileWith(rows, client(rows), evidence);
  assert.equal(result.profile.rounds.length, 0);
  assert.match(result.evidenceGaps[0]?.message ?? "", /does not prove wallet ownership/);
});

test("does not score when the order placement receipt proves another binary side", async () => {
  const row = fill();
  const rows = [row];
  const otherSide = { ...row, makerSide: "BUY_NO" as const };
  const evidence = mutateReceipt(rows, (hash, value) =>
    hash.toLowerCase() === placementHash.toLowerCase()
      ? { ...value, logs: orderPlacedLogs(otherSide) }
      : value
  );
  const result = await reconcileWith(rows, client(rows), evidence);
  assert.equal(result.profile.rounds.length, 0);
  assert.match(result.evidenceGaps[0]?.message ?? "", /does not prove the indexed binary side/);
});

test("reconstructs a taker fill only when its same transaction proves owner and side", async () => {
  const row = fill({
    maker: otherAccount,
    makerSide: "SELL_YES",
    taker: account,
    takerSide: "BUY_YES",
    takerOrder: { owner: account, side: "BUY_YES" },
  });
  const result = await reconcileWith([row]);
  assert.equal(result.profile.settledCount, 1);
  assert.equal(result.profile.rounds[0]?.fillTransactionHash, fillHash);
});

test("uses the chain block timestamp for the enrollment boundary", async () => {
  const row = fill({ timestamp: "999" });
  const rows = [row];
  const result = await new DreamDexProfileReconciler(
    client(rows),
    async () => settlement(),
    chainEvidence(rows),
  ).reconcile(account, { ...criteria, minimumTimestampSec: 150n });
  assert.equal(result.profile.rounds.length, 0);
});

test("caches shared fill receipts, placement receipts, orders, and block timestamps", async () => {
  const rows = [
    fill({ quantity: "400000" }),
    fill({ id: "100_2", txHash: fillHash, quantity: "600000" }),
  ];
  const baseEvidence = chainEvidence(rows);
  let receiptReads = 0;
  let timestampReads = 0;
  let orderReads = 0;
  const source = client(rows, {
    getOrder: async (_pool, orderId) => {
      orderReads += 1;
      return indexedOrder(rows.find((row) => participant(row).orderId === BigInt(orderId))!);
    },
  });
  const result = await reconcileWith(rows, source, {
    ...baseEvidence,
    getTransactionReceipt: async (hash) => {
      receiptReads += 1;
      return baseEvidence.getTransactionReceipt(hash);
    },
    getBlockTimestamp: async (blockNumber) => {
      timestampReads += 1;
      return baseEvidence.getBlockTimestamp(blockNumber);
    },
  });
  assert.equal(result.profile.rounds.length, 1);
  assert.equal(result.profile.rounds[0]?.quantity, 1_000_000n);
  assert.equal(receiptReads, 2);
  assert.equal(timestampReads, 1);
  assert.equal(orderReads, 1);
});
