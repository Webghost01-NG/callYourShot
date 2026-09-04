import {
  ORDER_TYPE,
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
  decodeRevert,
  orderBookEventsAbi,
  type BinaryOrderBook,
  type UnsignedCall,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  parseAbi,
  type Hex,
  type Address,
  type WalletClient,
} from "viem";
import { DreamDexAdapter, type DiscoveredMarket } from "../dreamdex/adapter.js";
import { DreamDexProfileReconciler } from "../dreamdex/reconciliation.js";
import { assertTradingWithHeadroom } from "../core/guards.js";
import { maximumBuyCost } from "../core/units.js";
import type { PublicAppConfig } from "./config.js";
import { selectedOutcomePrice } from "./quote.js";

const poolParametersAbi = parseAbi([
  "function getOrderBookParameters() view returns (uint256 tickSize, uint256 minQuantity, uint256 lotSize)",
]);
const approveAbi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const erc20MetadataAbi = parseAbi(["function symbol() view returns (string)"]);

export interface LiveRound {
  market: DiscoveredMarket;
  book: BinaryOrderBook;
  collateralSymbol: string;
}

export interface LiveMarketBoard {
  rounds: LiveRound[];
  rejectedCount: number;
  truncated: boolean;
}

export interface OrderPlan {
  account: Address;
  market: DiscoveredMarket;
  side: "BUY_YES" | "BUY_NO";
  yesPrice: bigint;
  selectedLimitPrice: bigint;
  quantity: bigint;
  maximumCost: bigint;
  approval?: UnsignedCall;
  order: UnsignedCall;
}

export interface SendPlanProgress {
  onApprovalSubmitted: (hash: Hex) => void;
  onApprovalConfirmed: (hash: Hex) => void;
  onOrderRequested: () => void;
  onOrderSubmitted: (hash: Hex) => void;
}

export function assertPlanAuthorization(
  plannedAccount: Address,
  activeAccount: Address | undefined,
  activeChainId: number | undefined,
) {
  if (!activeAccount || activeAccount.toLowerCase() !== plannedAccount.toLowerCase()) {
    throw new Error("The connected wallet changed after review. Review the call again.");
  }
  if (activeChainId !== somniaShannon.id) {
    throw new Error("Switch to Somnia Testnet, then review the call again.");
  }
}

export class BrowserDreamDexRuntime {
  private readonly exchange: SomniaMarkets;
  private readonly publicClient;
  private readonly collateralSymbols = new Map<string, Promise<string>>();

  constructor(private readonly config: PublicAppConfig) {
    this.exchange = new SomniaMarkets({
      indexerUrl: config.indexerUrl,
      chain: somniaShannon,
      wsRpcUrl: config.wsRpcUrl,
      addresses: SOMNIA_TESTNET_ADDRESSES,
    });
    this.publicClient = createPublicClient({
      chain: somniaShannon,
      transport: http(config.httpRpcUrl),
    });
  }

  private adapter(walletClient?: WalletClient) {
    const module = SOMNIA_TESTNET_ADDRESSES.binaryModule;
    if (!module) throw new Error("DreamDEX binary module is unavailable.");
    const trader = walletClient?.account
      ? this.exchange.client.createTrader({ walletClient, account: walletClient.account })
      : undefined;
    return new DreamDexAdapter(
      this.exchange.client,
      trader,
      module,
      async (pool, priceScale) => {
        const [tickSize, minQuantity, lotSize] = await this.publicClient.readContract({
          address: pool,
          abi: poolParametersAbi,
          functionName: "getOrderBookParameters",
        });
        return { tickSize, minQuantity, lotSize, priceScale };
      },
    );
  }

  private marketCriteria() {
    return {
      origin: { operatorId: this.config.operatorId, venueId: this.config.venueId },
      minimumHeadroomSec: 45n,
    };
  }

  private async readRound(market: DiscoveredMarket): Promise<LiveRound> {
    const key = market.collateral.toLowerCase();
    let symbol = this.collateralSymbols.get(key);
    if (!symbol) {
      symbol = this.publicClient.readContract({
        address: market.collateral,
        abi: erc20MetadataAbi,
        functionName: "symbol",
      }).then((value) => {
        const clean = value.trim().slice(0, 16);
        return clean || `${market.collateral.slice(0, 6)}…${market.collateral.slice(-4)}`;
      }).catch(() => `${market.collateral.slice(0, 6)}…${market.collateral.slice(-4)}`);
      this.collateralSymbols.set(key, symbol);
    }
    const [book, collateralSymbol] = await Promise.all([
      this.exchange.client.getBinaryOrderBook(market.pool, {
        decimals: market.indexed.quoteDecimals,
        depth: 10,
      }),
      symbol,
    ]);
    return { market, book, collateralSymbol };
  }

  async loadMarkets(): Promise<LiveMarketBoard> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const discovery = await this.adapter().discoverMarkets(this.marketCriteria());
        const rounds: LiveRound[] = [];
        let rejectedCount = discovery.rejectedCount;
        for (let start = 0; start < discovery.markets.length; start += 4) {
          const batch = discovery.markets.slice(start, start + 4);
          const settled = await Promise.allSettled(batch.map((market) => this.readRound(market)));
          for (const result of settled) {
            if (result.status === "fulfilled") rounds.push(result.value);
            else rejectedCount += 1;
          }
        }
        if (rounds.length === 0) {
          throw new Error("No verified live Event Contract has a readable order book.");
        }
        rounds.sort((left, right) => {
          const leftLiquid = left.book.yesAsks.length > 0 || left.book.noAsks.length > 0;
          const rightLiquid = right.book.yesAsks.length > 0 || right.book.noAsks.length > 0;
          if (leftLiquid !== rightLiquid) return leftLiquid ? -1 : 1;
          return left.market.expirySec < right.market.expirySec ? -1
            : left.market.expirySec > right.market.expirySec ? 1 : 0;
        });
        return { rounds, rejectedCount, truncated: discovery.truncated };
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
    }
    throw lastError;
  }

  async loadRound(): Promise<LiveRound> {
    return (await this.loadMarkets()).rounds[0]!;
  }

  async refreshRound(marketId: Hex): Promise<LiveRound> {
    const market = await this.adapter().discoverMarketById(this.marketCriteria(), marketId);
    return this.readRound(market);
  }

  async loadProfile(account: Address, walletClient: WalletClient) {
    if (walletClient.account?.address.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Connected wallet changed before profile reconciliation.");
    }
    return this.reconcileProfile(account, walletClient);
  }

  async loadPublicProfile(account: Address, minimumTimestampSec?: bigint) {
    const readOnlyWallet = createWalletClient({
      account,
      chain: somniaShannon,
      transport: http(this.config.httpRpcUrl),
    });
    return this.reconcileProfile(account, readOnlyWallet, minimumTimestampSec);
  }

  private async reconcileProfile(
    account: Address,
    walletClient: WalletClient,
    minimumTimestampSec?: bigint,
  ) {
    const adapter = this.adapter(walletClient);
    const reconciler = new DreamDexProfileReconciler(
      this.exchange.client,
      (marketId) => adapter.getSettlement(marketId),
    );
    return reconciler.reconcile(account, {
      origin: { operatorId: this.config.operatorId, venueId: this.config.venueId },
      minimumTimestampSec,
    });
  }

  async prepareOrder(input: {
    walletClient: WalletClient;
    market: DiscoveredMarket;
    side: "BUY_YES" | "BUY_NO";
    yesPrice: bigint;
    quantity: bigint;
  }): Promise<OrderPlan> {
    const account = input.walletClient.account?.address;
    if (!account) throw new Error("Connect a wallet before reviewing your call.");
    assertPlanAuthorization(account, account, input.walletClient.chain?.id);
    const selectedLimitPrice = selectedOutcomePrice(
      input.side,
      input.yesPrice,
      input.market.constraints.priceScale,
    );
    const maximumCost = maximumBuyCost(
      selectedLimitPrice,
      input.quantity,
      input.market.constraints.priceScale,
    );
    const allowance = await this.exchange.client.getErc20Allowance(
      input.market.collateral,
      account,
      input.market.pool,
    );
    const unsigned = await this.adapter(input.walletClient).prepareOrder(input.market, {
      side: input.side,
      price: input.yesPrice,
      quantity: input.quantity,
      orderType: ORDER_TYPE.MARKET,
      autoApprove: false,
      collateral: input.market.collateral,
      outcomeToken: input.market.outcomeToken,
      yesId: input.market.yesId,
      noId: input.market.noId,
    });
    const approval = allowance < maximumCost ? {
      to: input.market.collateral,
      data: encodeFunctionData({
        abi: approveAbi,
        functionName: "approve",
        args: [input.market.pool, maximumCost],
      }),
      value: 0n,
      description: `Approve at most ${maximumCost} collateral units for this call`,
    } satisfies UnsignedCall : undefined;
    return {
      account,
      market: input.market,
      side: input.side,
      yesPrice: input.yesPrice,
      selectedLimitPrice,
      quantity: input.quantity,
      maximumCost,
      approval,
      order: unsigned.order,
    };
  }

  async sendPlan(
    walletClient: WalletClient,
    plan: OrderPlan,
    progress: SendPlanProgress,
  ) {
    const account = walletClient.account;
    assertPlanAuthorization(plan.account, account?.address, walletClient.chain?.id);
    if (!account) throw new Error("Wallet disconnected before authorization.");
    const live = await this.exchange.client.getMarketOnchain(plan.market.marketId);
    try {
      assertTradingWithHeadroom({
        status: live.status,
        expirySec: live.expiry,
        nowSec: BigInt(Math.floor(Date.now() / 1_000)),
        minimumHeadroomSec: 30n,
      });
    } catch (cause) {
      throw new Error(
        "This round locked after review. No approval or order was submitted; refresh the live round.",
        { cause },
      );
    }
    if (live.pool.toLowerCase() !== plan.market.pool.toLowerCase()) {
      throw new Error("The live DreamDEX pool changed after review. Refresh the round and try again.");
    }
    if (plan.approval) {
      const { description: _approvalDescription, ...approval } = plan.approval;
      const approvalGas = await this.estimateCallGas(account.address, approval);
      const approvalHash = await walletClient.sendTransaction({
        ...approval,
        account,
        chain: somniaShannon,
        gas: approvalGas,
      });
      progress.onApprovalSubmitted(approvalHash);
      const approvalReceipt = await this.publicClient.waitForTransactionReceipt({ hash: approvalHash });
      if (approvalReceipt.status !== "success") throw new Error("Token approval reverted.");
      progress.onApprovalConfirmed(approvalHash);
    }
    const { description: _orderDescription, ...order } = plan.order;
    const orderGas = await this.estimateCallGas(account.address, order);
    progress.onOrderRequested();
    const hash = await walletClient.sendTransaction({
      ...order,
      account,
      chain: somniaShannon,
      gas: orderGas,
    });
    progress.onOrderSubmitted(hash);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const fills = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== plan.market.pool.toLowerCase()) return [];
      try {
        const decoded = decodeEventLog({ abi: orderBookEventsAbi, data: log.data, topics: log.topics });
        if (decoded.eventName !== "OrderFilled") return [];
        return [{
          takerOrderId: decoded.args.takerOrderId,
          makerOrderId: decoded.args.makerOrderId,
          quantityFilled: decoded.args.quantityFilled,
          takerRemainingQuantity: decoded.args.takerRemainingQuantity,
          makerRemainingQuantity: decoded.args.makerRemainingQuantity,
          fillPrice: decoded.args.fillPrice,
        }];
      } catch {
        return [];
      }
    });
    return this.adapter(walletClient).verifyOrder({ hash, receipt, fills });
  }

  private async estimateCallGas(
    account: Hex,
    call: Pick<UnsignedCall, "to" | "data" | "value">,
  ) {
    try {
      const estimate = await this.publicClient.estimateGas({
        account,
        to: call.to,
        data: call.data,
        value: call.value,
      });
      return estimate + estimate / 5n;
    } catch (cause) {
      const decoded = decodeRevert(cause, {
        address: call.to,
        functionName: "placeOrder",
      });
      if (decoded.errorName === "ImmediateOrCancelNoFill") {
        throw new Error(
          "The live price moved beyond your reviewed limit, so no order was submitted. Refresh and review the new price.",
          { cause },
        );
      }
      throw new Error(
        "DreamDEX rejected the transaction preflight. Refresh the live round before trying again.",
        { cause },
      );
    }
  }

  close() {
    return this.exchange.close();
  }
}
