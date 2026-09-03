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
  asset: string;
  intervalSec: number;
  origin: VenueOrigin;
  minimumHeadroomSec: bigint;
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

  async discoverMarket(criteria: MarketCriteria): Promise<DiscoveredMarket> {
    let rows: BinaryMarket[];
    try {
      rows = await this.client.listLiveBinaryMarkets({
        asset: criteria.asset,
        intervalSec: criteria.intervalSec,
        operatorId: criteria.origin.operatorId,
        venueId: criteria.origin.venueId,
        status: "Trading",
      });
    } catch (cause) {
      throw new UpstreamUnavailableError("DreamDEX market discovery failed", { cause });
    }

    for (const row of rows) {
      if (
        row.operatorId !== criteria.origin.operatorId
        || row.venueId?.toLowerCase() !== criteria.origin.venueId.toLowerCase()
      ) continue;
      const marketId = row.marketId as Hex;
      const onchain = await this.client.getMarketOnchain(marketId);
      try {
        assertTradingWithHeadroom({
          status: onchain.status,
          expirySec: onchain.expiry,
          nowSec: this.nowSec(),
          minimumHeadroomSec: criteria.minimumHeadroomSec,
        });
      } catch {
        continue;
      }
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
    }
    throw new UpstreamUnavailableError("No eligible live DreamDEX market was found");
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
