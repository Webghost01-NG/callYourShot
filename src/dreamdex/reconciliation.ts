import {
  ORDER_KIND_SIDE,
  orderBookEventsAbi,
} from "@somnia-chain/markets-sdk";
import {
  decodeEventLog,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import type { MarketEvidence, ProfileFill, SkillProfile } from "../core/profile.js";
import { reconcileProfile } from "../core/profile.js";
import type { VenueOrigin } from "./adapter.js";

const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const MARKET_RECONCILIATION_CONCURRENCY = 4;
const SETTLEMENT_PAYOUT_DENOMINATOR = 10_000_000n;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const FILL_ID = /^(\d+)_(\d+)$/;
const binaryOrderPlacedEvent = parseAbiItem(
  "event BinaryOrderPlaced(uint128 indexed orderId, uint8 kind)",
);

type IndexedSide = "BUY_YES" | "SELL_YES" | "BUY_NO" | "SELL_NO";

export interface IndexedProfileFill {
  id: string;
  market: string;
  fillPrice: string;
  quantity: string;
  maker: string | null;
  makerSide: IndexedSide | null;
  taker: string | null;
  takerSide: IndexedSide | null;
  takerOrder: { owner: string; side: IndexedSide | null } | null;
  makerOrderId: string;
  takerOrderId: string;
  timestamp: string;
  txHash: string;
}

export interface IndexedProfileMarket {
  marketId: Hex;
  marketType: "BINARY";
  asset: string;
  question: string;
  baseDecimals: number;
  quoteDecimals: number;
  collateral: Address;
  poolAddress: Address;
  intervalSec?: string | null;
  operatorId?: number | null;
  venueId?: Hex | null;
}

export interface IndexedProfileOrder {
  orderId: string;
  owner: string;
  side: IndexedSide | null;
  pool: string;
  market: string;
  placedTxHash: string;
  placedAtBlock: string;
}

export interface OnchainProfileMarket {
  collateral: Address;
  pool: Address;
  decimals: number;
  finalized: boolean;
  isResolved: boolean;
  isVoided: boolean;
  winningOutcome: number;
}

export interface ProfileSettlement {
  collateralToken: Address;
  pool: Address;
  finalized: boolean;
  voided: boolean;
  winningOutcome: number;
  payoutNumerators: readonly bigint[];
}

export interface ProfileEvidenceClient {
  getUserFills(
    account: string,
    options: { limit: number; offset: number; until: number },
  ): Promise<IndexedProfileFill[]>;
  getBinaryMarket(marketId: string): Promise<IndexedProfileMarket | null>;
  getOrder(pool: string, orderId: bigint | string): Promise<IndexedProfileOrder | null>;
  listPastBinaryMarkets?(options: {
    asset?: string;
    intervalSec?: number;
    operatorId: number;
    venueId: string;
    limit: number;
    offset: number;
    nowSec: number;
  }): Promise<IndexedProfileMarket[]>;
  getMarketOnchain(marketId: Hex): Promise<OnchainProfileMarket>;
  getMarketResolution(marketId: string): Promise<{
    events: readonly { txHash: string }[];
    closingAnswer: { txHash: string | null } | null;
  }>;
  getMarketStatusHistory(marketId: string): Promise<readonly {
    newStatus: string;
    blockNumber: string;
    txHash: string;
  }[]>;
}

export interface ProfileTransactionLog {
  address: Address;
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hex | null;
  data: Hex;
  topics: [] | [Hex, ...Hex[]];
}

export interface ProfileTransactionReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  transactionHash: Hex;
  logs: readonly ProfileTransactionLog[];
}

export interface ProfileChainEvidenceReader {
  getTransactionReceipt(hash: Hex): Promise<ProfileTransactionReceipt>;
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
  getFinalizationTransaction?(marketId: Hex, blockNumber: bigint): Promise<Hex | null>;
}

export interface ProfileCriteria {
  asset?: string;
  intervalSec?: number;
  origin: VenueOrigin;
  minimumTimestampSec?: bigint;
}

export interface EvidenceGap {
  marketId: Hex | null;
  kind: "fill" | "market" | "settlement" | "oracle" | "finalization";
  message: string;
}

export interface ReconciledProfile {
  profile: SkillProfile;
  snapshotTimestampSec: bigint;
  sourceBlock: bigint;
  evidenceGaps: EvidenceGap[];
}

function lower(value: string | null | undefined): string {
  return value?.toLowerCase() ?? "";
}

function asUnsigned(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} is not an unsigned integer`);
  return BigInt(value);
}

function asTransactionHash(value: string | null | undefined): Hex | null {
  return value && TRANSACTION_HASH.test(value) ? value as Hex : null;
}

async function readWithRetry<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    return read();
  }
}

async function forEachWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const value = values[cursor++];
      if (value !== undefined) await task(value);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
}

function supportedMarket(market: IndexedProfileMarket, criteria: ProfileCriteria): boolean {
  return (criteria.asset === undefined || market.asset.toUpperCase() === criteria.asset.toUpperCase())
    && (criteria.intervalSec === undefined || Number(market.intervalSec) === criteria.intervalSec)
    && market.operatorId === criteria.origin.operatorId
    && lower(market.venueId) === lower(criteria.origin.venueId);
}

interface IndexedFillCandidate {
  fill: ProfileFill;
  makerOrderId: bigint;
  takerOrderId: bigint;
  role: "maker" | "taker";
}

function indexedFillFor(account: Address, row: IndexedProfileFill): IndexedFillCandidate | null {
  const accountKey = lower(account);
  const maker = lower(row.maker) === accountKey;
  const takerOwner = lower(row.takerOrder?.owner);
  const taker = lower(row.taker) === accountKey || takerOwner === accountKey;
  if (!maker && !taker) throw new Error("fill no longer attributes the connected wallet");
  if (maker && taker) throw new Error("self-trade attribution is ambiguous");

  const side = maker ? row.makerSide : (row.takerOrder?.side ?? row.takerSide);
  if (!side) throw new Error("fill side has not been indexed yet");
  if (side === "SELL_YES" || side === "SELL_NO") return null;

  const match = row.id.match(FILL_ID);
  if (!match) throw new Error("fill ID has no block/log position");
  if (!BYTES32.test(row.market)) throw new Error("fill market is not a bytes32 ID");
  if (!TRANSACTION_HASH.test(row.txHash)) throw new Error("fill transaction hash is invalid");
  const logIndex = Number(match[2]);
  if (!Number.isSafeInteger(logIndex)) throw new Error("fill log index is unsafe");

  const quantity = asUnsigned(row.quantity, "fill quantity");
  if (quantity === 0n) throw new Error("fill quantity is zero");
  const makerOrderId = asUnsigned(row.makerOrderId, "maker order ID");
  const takerOrderId = asUnsigned(row.takerOrderId, "taker order ID");
  return {
    fill: {
      id: row.id,
      marketId: row.market as Hex,
      transactionHash: row.txHash as Hex,
      timestampSec: asUnsigned(row.timestamp, "fill timestamp"),
      blockNumber: asUnsigned(match[1]!, "fill block"),
      logIndex,
      orderId: maker ? makerOrderId : takerOrderId,
      side,
      yesPrice: asUnsigned(row.fillPrice, "fill price"),
      quantity,
    },
    makerOrderId,
    takerOrderId,
    role: maker ? "maker" : "taker",
  };
}

function sameHex(left: string | null | undefined, right: string): boolean {
  return lower(left) === lower(right);
}

function decodeOrderFilled(log: ProfileTransactionLog) {
  try {
    const decoded = decodeEventLog({
      abi: orderBookEventsAbi,
      data: log.data,
      topics: log.topics,
    });
    return decoded.eventName === "OrderFilled" ? decoded.args : null;
  } catch {
    return null;
  }
}

function receiptLogAt(
  receipt: ProfileTransactionReceipt,
  logIndex: number,
): ProfileTransactionLog {
  const matches = receipt.logs.filter((log) => log.logIndex === logIndex);
  if (matches.length !== 1) {
    throw new Error("fill receipt does not contain one exact indexed log position");
  }
  return matches[0]!;
}

function assertSuccessfulReceipt(
  receipt: ProfileTransactionReceipt,
  hash: Hex,
  blockNumber?: bigint,
): void {
  if (receipt.status !== "success") throw new Error("referenced transaction reverted");
  if (!sameHex(receipt.transactionHash, hash)) {
    throw new Error("RPC receipt transaction hash disagrees with indexed evidence");
  }
  if (blockNumber !== undefined && receipt.blockNumber !== blockNumber) {
    throw new Error("RPC receipt block disagrees with indexed fill position");
  }
}

function assertOrderPlacement(input: {
  receipt: ProfileTransactionReceipt;
  pool: Address;
  orderId: bigint;
  account: Address;
  side: "BUY_YES" | "BUY_NO";
}): void {
  let ownerVerified = false;
  let sideVerified = false;
  for (const log of input.receipt.logs) {
    if (!sameHex(log.address, input.pool)) continue;
    try {
      const decoded = decodeEventLog({
        abi: orderBookEventsAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "OrderPlaced") {
        const placed = decoded.args.placedOrder;
        if (
          decoded.args.orderId === input.orderId
          && placed.orderId === input.orderId
          && sameHex(placed.owner, input.account)
        ) ownerVerified = true;
      }
    } catch {
      // The receipt also contains token and binary-pool-specific events.
    }
    try {
      const decoded = decodeEventLog({
        abi: [binaryOrderPlacedEvent],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.args.orderId !== input.orderId) continue;
      const side = ORDER_KIND_SIDE[Number(decoded.args.kind)];
      if (side === input.side) sideVerified = true;
    } catch {
      // Not a BinaryOrderPlaced log.
    }
  }
  if (!ownerVerified) throw new Error("order placement receipt does not prove wallet ownership");
  if (!sideVerified) throw new Error("order placement receipt does not prove the indexed binary side");
}

async function verifyFillCandidate(input: {
  account: Address;
  candidate: IndexedFillCandidate;
  pool: Address;
  receiptFor: (hash: Hex) => Promise<ProfileTransactionReceipt>;
  blockTimestampFor: (blockNumber: bigint) => Promise<bigint>;
  orderFor: (pool: Address, orderId: bigint) => Promise<IndexedProfileOrder>;
}): Promise<ProfileFill> {
  const { fill } = input.candidate;
  const receipt = await input.receiptFor(fill.transactionHash);
  assertSuccessfulReceipt(receipt, fill.transactionHash, fill.blockNumber);
  const log = receiptLogAt(receipt, fill.logIndex);
  if (!sameHex(log.address, input.pool)) {
    throw new Error("indexed fill log was not emitted by the verified market pool");
  }
  if (log.blockNumber !== null && log.blockNumber !== fill.blockNumber) {
    throw new Error("fill log block disagrees with its indexed position");
  }
  if (log.transactionHash !== null && !sameHex(log.transactionHash, fill.transactionHash)) {
    throw new Error("fill log transaction hash disagrees with its indexed evidence");
  }
  const decoded = decodeOrderFilled(log);
  if (!decoded) throw new Error("exact indexed log is not a decodable OrderFilled event");
  if (
    decoded.makerOrderId !== input.candidate.makerOrderId
    || decoded.takerOrderId !== input.candidate.takerOrderId
  ) throw new Error("OrderFilled order IDs disagree with the indexer row");
  if (decoded.quantityFilled !== fill.quantity) {
    throw new Error("OrderFilled quantity disagrees with the indexer row");
  }
  if (decoded.fillPrice !== fill.yesPrice) {
    throw new Error("OrderFilled price disagrees with the indexer row");
  }

  const order = await input.orderFor(input.pool, fill.orderId);
  if (asUnsigned(order.orderId, "indexed order ID") !== fill.orderId) {
    throw new Error("indexed participant order ID disagrees with the fill");
  }
  if (!sameHex(order.owner, input.account)) {
    throw new Error("indexed participant order owner disagrees with the profile wallet");
  }
  if (order.side !== fill.side) {
    throw new Error("indexed participant order side disagrees with the fill");
  }
  if (!sameHex(order.pool, input.pool)) {
    throw new Error("indexed participant order pool disagrees with the verified market");
  }
  if (!sameHex(order.market, fill.marketId)) {
    throw new Error("indexed participant order market disagrees with the fill");
  }
  const placementHash = asTransactionHash(order.placedTxHash);
  if (!placementHash) throw new Error("participant order placement hash is invalid");
  if (input.candidate.role === "taker" && !sameHex(placementHash, fill.transactionHash)) {
    throw new Error("taker order was not placed in its fill transaction");
  }
  const placementBlock = asUnsigned(order.placedAtBlock, "order placement block");
  const placementReceipt = await input.receiptFor(placementHash);
  assertSuccessfulReceipt(placementReceipt, placementHash, placementBlock);
  assertOrderPlacement({
    receipt: placementReceipt,
    pool: input.pool,
    orderId: fill.orderId,
    account: input.account,
    side: fill.side,
  });

  return {
    ...fill,
    timestampSec: await input.blockTimestampFor(fill.blockNumber),
  };
}

function validateSettlement(
  onchain: OnchainProfileMarket,
  settlement: ProfileSettlement,
): 0 | 1 | null {
  if (!settlement.finalized) throw new Error("permanent settlement record is not finalized");
  if (lower(settlement.collateralToken) !== lower(onchain.collateral)) {
    throw new Error("settlement collateral disagrees with the market");
  }
  if (lower(settlement.pool) !== lower(onchain.pool)) {
    throw new Error("settlement pool disagrees with the market");
  }
  if (settlement.voided !== onchain.isVoided) {
    throw new Error("settlement void state disagrees with the market");
  }
  if (settlement.voided) return null;
  if (!onchain.isResolved) throw new Error("finalized non-void market is not resolved");
  if (settlement.winningOutcome !== 0 && settlement.winningOutcome !== 1) {
    throw new Error("settlement has no binary winner");
  }
  if (settlement.payoutNumerators.length < 2) {
    throw new Error("settlement payout vector is incomplete");
  }
  const other = settlement.winningOutcome === 0 ? 1 : 0;
  if (settlement.payoutNumerators[settlement.winningOutcome]! <= settlement.payoutNumerators[other]!) {
    throw new Error("settlement payout vector has no unique winner");
  }
  if (onchain.winningOutcome !== settlement.winningOutcome) {
    throw new Error("settlement winner disagrees with the market contract");
  }
  return settlement.winningOutcome;
}

export class DreamDexProfileReconciler {
  constructor(
    private readonly client: ProfileEvidenceClient,
    private readonly getSettlement: (marketId: Hex) => Promise<ProfileSettlement>,
    private readonly chainEvidence: ProfileChainEvidenceReader,
    private readonly nowSec: () => bigint = () => BigInt(Math.floor(Date.now() / 1_000)),
  ) {}

  async reconcile(account: Address, criteria: ProfileCriteria): Promise<ReconciledProfile> {
    if (!ADDRESS.test(account)) throw new Error("profile account is not a valid address");
    const snapshotTimestampSec = this.nowSec();
    const rows: IndexedProfileFill[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const next = await readWithRetry(() => this.client.getUserFills(account, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        until: Number(snapshotTimestampSec),
      }));
      rows.push(...next);
      if (next.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) {
        throw new Error("fill history exceeds the safe reconciliation limit");
      }
    }

    const grouped = new Map<string, IndexedProfileFill[]>();
    for (const row of rows) {
      if (!BYTES32.test(row.market)) continue;
      const key = row.market.toLowerCase();
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }

    const recentSupportedMarkets = grouped.size > 0 && this.client.listPastBinaryMarkets
      ? readWithRetry(() => this.client.listPastBinaryMarkets!({
          ...(criteria.asset === undefined ? {} : { asset: criteria.asset }),
          ...(criteria.intervalSec === undefined ? {} : { intervalSec: criteria.intervalSec }),
          operatorId: criteria.origin.operatorId,
          venueId: criteria.origin.venueId,
          limit: 100,
          offset: 0,
          nowSec: Number(snapshotTimestampSec),
        })).then((items) => new Map(items.map((item) => [item.marketId.toLowerCase(), item])))
      : null;

    const fills: ProfileFill[] = [];
    const markets = new Map<string, MarketEvidence>();
    const evidenceGaps: EvidenceGap[] = [];
    let sourceBlock = 0n;
    const receiptCache = new Map<string, Promise<ProfileTransactionReceipt>>();
    const blockTimestampCache = new Map<bigint, Promise<bigint>>();
    const orderCache = new Map<string, Promise<IndexedProfileOrder>>();
    const receiptFor = (hash: Hex) => {
      const key = lower(hash);
      const cached = receiptCache.get(key);
      if (cached) return cached;
      const pending = readWithRetry(() => this.chainEvidence.getTransactionReceipt(hash));
      receiptCache.set(key, pending);
      return pending;
    };
    const blockTimestampFor = (blockNumber: bigint) => {
      const cached = blockTimestampCache.get(blockNumber);
      if (cached) return cached;
      const pending = readWithRetry(() => this.chainEvidence.getBlockTimestamp(blockNumber));
      blockTimestampCache.set(blockNumber, pending);
      return pending;
    };
    const orderFor = (pool: Address, orderId: bigint) => {
      const key = `${lower(pool)}_${orderId}`;
      const cached = orderCache.get(key);
      if (cached) return cached;
      const pending = readWithRetry(() => this.client.getOrder(pool, orderId)).then((order) => {
        if (!order) throw new Error("participant order is unavailable from the candidate index");
        return order;
      });
      orderCache.set(key, pending);
      return pending;
    };
    await forEachWithConcurrency(
      [...grouped.entries()],
      MARKET_RECONCILIATION_CONCURRENCY,
      async ([key, marketRows]) => {
      const marketId = key as Hex;
      let indexed: IndexedProfileMarket | null;
      try {
        const candidates: Promise<IndexedProfileMarket>[] = [
          readWithRetry(() => this.client.getBinaryMarket(marketId)).then((item) => {
            if (!item) throw new Error("market is not an indexed binary market");
            return item;
          }),
        ];
        if (recentSupportedMarkets) {
          candidates.push(recentSupportedMarkets.then((items) => {
            const item = items.get(key);
            if (!item) throw new Error("market is outside the recent configured series");
            return item;
          }));
        }
        indexed = await Promise.any(candidates);
      } catch (error) {
        evidenceGaps.push({ marketId, kind: "market", message: `Market metadata unavailable: ${errorMessage(error)}` });
        return;
      }
      if (!indexed || !supportedMarket(indexed, criteria)) return;

      let fillCandidates: IndexedFillCandidate[];
      try {
        fillCandidates = marketRows.flatMap((row) => {
          const converted = indexedFillFor(account, row);
          if (!converted) return [];
          return [converted];
        });
      } catch (error) {
        evidenceGaps.push({ marketId, kind: "fill", message: `Fill evidence incomplete: ${errorMessage(error)}` });
        return;
      }
      if (fillCandidates.length === 0) return;

      let onchain: OnchainProfileMarket;
      try {
        onchain = await readWithRetry(() => this.client.getMarketOnchain(marketId));
        if (lower(indexed.collateral) !== lower(onchain.collateral)) {
          throw new Error("indexed collateral disagrees with the market contract");
        }
        if (lower(indexed.poolAddress) !== lower(onchain.pool)) {
          throw new Error("indexed pool disagrees with the market contract");
        }
        if (indexed.quoteDecimals !== onchain.decimals) {
          throw new Error("indexed decimals disagree with the collateral contract");
        }
      } catch (error) {
        evidenceGaps.push({ marketId, kind: "market", message: `On-chain market evidence unavailable: ${errorMessage(error)}` });
        return;
      }

      let marketFills: ProfileFill[];
      try {
        marketFills = (await Promise.all(fillCandidates.map((candidate) => verifyFillCandidate({
          account,
          candidate,
          pool: onchain.pool,
          receiptFor,
          blockTimestampFor,
          orderFor,
        })))).filter((fill) =>
          criteria.minimumTimestampSec === undefined
          || fill.timestampSec >= criteria.minimumTimestampSec
        );
      } catch (error) {
        evidenceGaps.push({
          marketId,
          kind: "fill",
          message: `On-chain fill verification failed: ${errorMessage(error)}`,
        });
        return;
      }
      if (marketFills.length === 0) return;
      for (const fill of marketFills) {
        if (fill.blockNumber > sourceBlock) sourceBlock = fill.blockNumber;
      }

      let winner: 0 | 1 | null = null;
      let payoutNumerators: readonly bigint[] | null = null;
      if (onchain.finalized) {
        try {
          const settlement = await readWithRetry(() => this.getSettlement(marketId));
          winner = validateSettlement(onchain, settlement);
          payoutNumerators = settlement.payoutNumerators;
        } catch (error) {
          evidenceGaps.push({ marketId, kind: "settlement", message: `Settlement evidence unavailable: ${errorMessage(error)}` });
          return;
        }
      }

      let settlementTransactionHash: Hex | null = null;
      let oracleTransactionHash: Hex | null = null;
      if (onchain.finalized) {
        try {
          const history = await readWithRetry(() => this.client.getMarketStatusHistory(marketId));
          const reversedHistory = [...history].reverse();
          for (const entry of history) {
            if (/^\d+$/.test(entry.blockNumber)) {
              const blockNumber = BigInt(entry.blockNumber);
              if (blockNumber > sourceBlock) sourceBlock = blockNumber;
            }
          }
          settlementTransactionHash = asTransactionHash(
            reversedHistory.find((entry) => entry.newStatus === "Finalized")?.txHash,
          );
          const terminalTransition = reversedHistory.find((entry) =>
            entry.newStatus === "Resolved" || entry.newStatus === "Voided",
          );
          if (!settlementTransactionHash && terminalTransition && this.chainEvidence.getFinalizationTransaction) {
            settlementTransactionHash = await readWithRetry(() => this.chainEvidence.getFinalizationTransaction!(
              marketId,
              asUnsigned(terminalTransition.blockNumber, "terminal market block"),
            ));
          }
          if (!settlementTransactionHash) {
            evidenceGaps.push({ marketId, kind: "finalization", message: "Finalization is verified on-chain, but its indexed transaction link is unavailable." });
          }
        } catch (error) {
          evidenceGaps.push({ marketId, kind: "finalization", message: `Finalization is verified on-chain, but its transaction link is unavailable: ${errorMessage(error)}` });
        }
        try {
          const resolution = await readWithRetry(() => this.client.getMarketResolution(marketId));
          oracleTransactionHash = asTransactionHash(resolution.closingAnswer?.txHash);
          if (!oracleTransactionHash) {
            evidenceGaps.push({ marketId, kind: "oracle", message: "Oracle outcome is verified by settlement, but its indexed transaction link is unavailable." });
          }
        } catch (error) {
          evidenceGaps.push({ marketId, kind: "oracle", message: `Oracle outcome is verified by settlement, but its transaction link is unavailable: ${errorMessage(error)}` });
        }
      }

      fills.push(...marketFills);
      markets.set(key, {
        marketId,
        question: indexed.question,
        collateral: onchain.collateral,
        decimals: indexed.quoteDecimals,
        quantityDecimals: indexed.baseDecimals,
        finalized: onchain.finalized,
        voided: onchain.finalized && onchain.isVoided,
        winningOutcome: winner,
        payoutNumerators,
        payoutDenominator: onchain.finalized ? SETTLEMENT_PAYOUT_DENOMINATOR : null,
        settlementTransactionHash,
        oracleTransactionHash,
      });
      },
    );

    return {
      profile: reconcileProfile({ account, fills, markets }),
      snapshotTimestampSec,
      sourceBlock,
      evidenceGaps,
    };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map((item) => item instanceof Error ? item.message : String(item)).join("; ");
  }
  return error instanceof Error ? error.message : "unknown upstream failure";
}
