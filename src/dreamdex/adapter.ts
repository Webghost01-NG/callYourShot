import type {
  BinaryMarket,
  MarketOnchain,
  PlaceOrderParams,
  SettlementRecord,
  SomniaMarketsClient,
  Trader,
  UnsignedOrder,
} from "@somnia-chain/markets-sdk";
import type { Address, Hex } from "viem";
import { UpstreamUnavailableError } from "../core/errors.js";
import { verifyFilledExecution } from "../core/execution.js";
import { assertFinalized, assertTradingWithHeadroom } from "../core/guards.js";
import { getClaimablePositions, type RedemptionIntent } from "../core/settlement.js";
import { assertOrderUnits, type BookConstraints } from "../core/units.js";

export interface VenueOrigin {
  operatorId: number;
  venueId: string;
}

export interface MarketCriteria {
  asset?: string;
  intervalSec?: number;
  origin: VenueOrigin;
  minimumHeadroomSec: bigint;
}

export interface MarketDiscoveryResult {
  markets: DiscoveredMarket[];
  rejectedCount: number;
  truncated: boolean;
}

export interface DiscoveredMarket {
  marketId: Hex;
  pool: Address;
  marketAddress: Address;
  collateral: Address;
  outcomeToken: Address;
  yesId: bigint;
  noId: bigint;
  expirySec: bigint;
  constraints: BookConstraints;
  indexed: BinaryMarket;
  onchain: MarketOnchain;
}

type ReadClient = Pick<
  SomniaMarketsClient,
  | "getBinaryMarket"
  | "getMarketOnchain"
  | "getOutcomeBalance"
  | "listLiveBinaryMarkets"
>;

type OrderBuilder = Pick<Trader, "buildPlaceOrder" | "getSettlement">;

const LIVE_PAGE_SIZE = 25;
const MAX_LIVE_PAGES = 4;
const MAX_DISCOVERED_MARKETS = 12;
const VERIFICATION_CONCURRENCY = 4;

export class DreamDexAdapter {
  constructor(
    private readonly client: ReadClient,
    private readonly orderBuilder: OrderBuilder | undefined,
    private readonly module: Address,
    private readonly readBookConstraints: (
      pool: Address,
      priceScale: bigint,
    ) => Promise<BookConstraints>,
    private readonly nowSec: () => bigint = () => BigInt(Math.floor(Date.now() / 1_000)),
  ) {}

  private matchesCriteria(row: BinaryMarket, criteria: MarketCriteria): boolean {
    return row.operatorId === criteria.origin.operatorId
      && row.venueId?.toLowerCase() === criteria.origin.venueId.toLowerCase()
      && (criteria.asset === undefined || row.asset?.toUpperCase() === criteria.asset.toUpperCase())
      && (criteria.intervalSec === undefined || Number(row.intervalSec) === criteria.intervalSec);
  }

  private async verifyCandidate(
    row: BinaryMarket,
    criteria: MarketCriteria,
  ): Promise<DiscoveredMarket | null> {
    if (!this.matchesCriteria(row, criteria) || !/^0x[0-9a-fA-F]{64}$/.test(row.marketId)) {
      return null;
    }
    const marketId = row.marketId as Hex;
    try {
      const onchain = await this.client.getMarketOnchain(marketId);
      if (
        row.poolAddress.toLowerCase() !== onchain.pool.toLowerCase()
        || row.marketAddress.toLowerCase() !== onchain.marketAddress.toLowerCase()
        || row.collateral.toLowerCase() !== onchain.collateral.toLowerCase()
        || BigInt(row.yesTokenId) !== onchain.yesId
        || BigInt(row.noTokenId) !== onchain.noId
        || row.quoteDecimals !== onchain.decimals
      ) return null;
      assertTradingWithHeadroom({
        status: onchain.status,
        expirySec: onchain.expiry,
        nowSec: this.nowSec(),
        minimumHeadroomSec: criteria.minimumHeadroomSec,
      });
      if (!Number.isSafeInteger(row.quoteDecimals) || row.quoteDecimals < 0) return null;
      const priceScale = 10n ** BigInt(row.quoteDecimals);
      return {
        marketId,
        pool: onchain.pool,
        marketAddress: onchain.marketAddress,
        collateral: onchain.collateral,
        outcomeToken: onchain.outcomeToken,
        yesId: onchain.yesId,
        noId: onchain.noId,
        expirySec: onchain.expiry,
        constraints: await this.readBookConstraints(onchain.pool, priceScale),
        indexed: row,
        onchain,
      };
    } catch {
      return null;
    }
  }

  async discoverMarkets(criteria: MarketCriteria): Promise<MarketDiscoveryResult> {
    const markets: DiscoveredMarket[] = [];
    const seen = new Set<string>();
    let rejectedCount = 0;
    let truncated = false;
    for (let page = 0; page < MAX_LIVE_PAGES && markets.length < MAX_DISCOVERED_MARKETS; page += 1) {
      let rows: BinaryMarket[];
      try {
        rows = await this.client.listLiveBinaryMarkets({
          ...(criteria.asset === undefined ? {} : { asset: criteria.asset }),
          ...(criteria.intervalSec === undefined ? {} : { intervalSec: criteria.intervalSec }),
          operatorId: criteria.origin.operatorId,
          venueId: criteria.origin.venueId,
          status: "Trading",
          limit: LIVE_PAGE_SIZE,
          offset: page * LIVE_PAGE_SIZE,
        });
      } catch (cause) {
        if (markets.length > 0) {
          truncated = true;
          break;
        }
        throw new UpstreamUnavailableError("DreamDEX market discovery failed", { cause });
      }
      const candidates = rows.filter((row) => {
        if (typeof row.marketId !== "string") {
          rejectedCount += 1;
          return false;
        }
        const key = row.marketId.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      for (let start = 0; start < candidates.length && markets.length < MAX_DISCOVERED_MARKETS; start += VERIFICATION_CONCURRENCY) {
        const batch = candidates.slice(start, start + VERIFICATION_CONCURRENCY);
        const verified = await Promise.all(batch.map((row) => this.verifyCandidate(row, criteria)));
        for (const market of verified) {
          if (!market) {
            rejectedCount += 1;
          } else if (markets.length < MAX_DISCOVERED_MARKETS) {
            markets.push(market);
          } else {
            truncated = true;
          }
        }
      }
      if (rows.length < LIVE_PAGE_SIZE) break;
      if (page === MAX_LIVE_PAGES - 1 || markets.length === MAX_DISCOVERED_MARKETS) truncated = true;
    }
    if (markets.length === 0) {
      throw new UpstreamUnavailableError("No eligible live DreamDEX Event Contract was found");
    }
    return { markets, rejectedCount, truncated };
  }

  async discoverMarket(criteria: MarketCriteria): Promise<DiscoveredMarket> {
    return (await this.discoverMarkets(criteria)).markets[0]!;
  }

  async discoverMarketById(criteria: MarketCriteria, marketId: Hex): Promise<DiscoveredMarket> {
    let indexed: BinaryMarket | null;
    try {
      indexed = await this.client.getBinaryMarket(marketId);
    } catch (cause) {
      throw new UpstreamUnavailableError("DreamDEX market refresh failed", { cause });
    }
    if (!indexed) throw new UpstreamUnavailableError("The selected Event Contract is unavailable");
    const market = await this.verifyCandidate(indexed, criteria);
    if (!market) throw new UpstreamUnavailableError("The selected Event Contract is no longer tradable");
    return market;
  }

  async prepareOrder(
    market: DiscoveredMarket,
    params: Omit<PlaceOrderParams, "pool">,
  ): Promise<UnsignedOrder> {
    if (!this.orderBuilder) {
      throw new UpstreamUnavailableError("A wallet-bound order builder is required");
    }
    const live = await this.client.getMarketOnchain(market.marketId);
    assertTradingWithHeadroom({
      status: live.status,
      expirySec: live.expiry,
      nowSec: this.nowSec(),
      minimumHeadroomSec: 30n,
    });
    assertOrderUnits(params.price, params.quantity, market.constraints);
    return this.orderBuilder.buildPlaceOrder({
      ...params,
      pool: live.pool,
    });
  }

  verifyOrder(result: Awaited<ReturnType<Trader["placeOrder"]>>) {
    return verifyFilledExecution({
      transactionHash: result.hash,
      receiptStatus: result.receipt.status,
      fills: result.fills,
    });
  }

  async getSettlement(marketId: Hex): Promise<SettlementRecord> {
    if (!this.orderBuilder) {
      throw new UpstreamUnavailableError("A configured settlement reader is required");
    }
    const onchain = await this.client.getMarketOnchain(marketId);
    assertFinalized(onchain);
    const settlement = await this.orderBuilder.getSettlement(marketId);
    if (!settlement?.finalized) {
      throw new UpstreamUnavailableError("Finalized settlement record is unavailable");
    }
    return settlement;
  }

  async prepareRedemptions(
    marketId: Hex,
    account: Address,
  ): Promise<RedemptionIntent[]> {
    const market = await this.client.getBinaryMarket(marketId);
    if (!market) throw new UpstreamUnavailableError("Indexed market is unavailable");
    const onchain = await this.client.getMarketOnchain(marketId);
    const settlement = await this.getSettlement(marketId);
    const balances = await Promise.all([
      this.client.getOutcomeBalance({
        outcomeToken: onchain.outcomeToken,
        account,
        id: onchain.yesId,
      }),
      this.client.getOutcomeBalance({
        outcomeToken: onchain.outcomeToken,
        account,
        id: onchain.noId,
      }),
    ]);
    const claimable = getClaimablePositions({
      marketId,
      finalized: settlement.finalized,
      isResolved: onchain.isResolved,
      isVoided: settlement.voided,
      winningOutcome: settlement.winningOutcome,
      payoutNumerators: settlement.payoutNumerators,
      payoutDenominator: 10_000_000n,
      balances,
    });
    return claimable.map((position) => ({
      ...position,
      module: this.module,
      outcomeToken: onchain.outcomeToken,
    }));
  }
}
