import type { Address, Hex } from "viem";
import type { MarketEvidence, ProfileFill, SkillProfile } from "../core/profile.js";
import { reconcileProfile } from "../core/profile.js";
import type { VenueOrigin } from "./adapter.js";

const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const SETTLEMENT_PAYOUT_DENOMINATOR = 10_000_000n;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const FILL_ID = /^(\d+)_(\d+)$/;

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

function supportedMarket(market: IndexedProfileMarket, criteria: ProfileCriteria): boolean {
  return (criteria.asset === undefined || market.asset.toUpperCase() === criteria.asset.toUpperCase())
    && (criteria.intervalSec === undefined || Number(market.intervalSec) === criteria.intervalSec)
    && market.operatorId === criteria.origin.operatorId
    && lower(market.venueId) === lower(criteria.origin.venueId);
}

function indexedFillFor(account: Address, row: IndexedProfileFill): ProfileFill | null {
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
  return {
    id: row.id,
    marketId: row.market as Hex,
    transactionHash: row.txHash as Hex,
    timestampSec: asUnsigned(row.timestamp, "fill timestamp"),
    blockNumber: asUnsigned(match[1]!, "fill block"),
    logIndex,
    orderId: asUnsigned(maker ? row.makerOrderId : row.takerOrderId, "fill order ID"),
    side,
    yesPrice: asUnsigned(row.fillPrice, "fill price"),
    quantity,
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
    private readonly getFinalizationTransaction?: (marketId: Hex, blockNumber: bigint) => Promise<Hex | null>,
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
      if (
        criteria.minimumTimestampSec !== undefined
        && /^\d+$/.test(row.timestamp)
        && BigInt(row.timestamp) < criteria.minimumTimestampSec
      ) continue;
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
    for (const [key, marketRows] of grouped) {
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
        continue;
      }
      if (!indexed || !supportedMarket(indexed, criteria)) continue;

      let marketFills: ProfileFill[];
      try {
        marketFills = marketRows.flatMap((row) => {
          const converted = indexedFillFor(account, row);
          if (!converted) return [];
          if (
            criteria.minimumTimestampSec !== undefined
            && converted.timestampSec < criteria.minimumTimestampSec
          ) return [];
          return [converted];
        });
      } catch (error) {
        evidenceGaps.push({ marketId, kind: "fill", message: `Fill evidence incomplete: ${errorMessage(error)}` });
        continue;
      }
      if (marketFills.length === 0) continue;
      for (const fill of marketFills) {
        if (fill.blockNumber > sourceBlock) sourceBlock = fill.blockNumber;
      }

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
        continue;
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
          continue;
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
          if (!settlementTransactionHash && terminalTransition && this.getFinalizationTransaction) {
            settlementTransactionHash = await readWithRetry(() => this.getFinalizationTransaction!(
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
    }

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
