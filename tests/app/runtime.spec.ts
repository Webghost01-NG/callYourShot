import { describe, expect, it, vi } from "vitest";
import type { Address, Hex, WalletClient } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import {
  assertPlanAuthorization,
  BrowserDreamDexRuntime,
  type OrderPlan,
} from "../../src/app/runtime.js";

const reviewedWallet = "0x1111111111111111111111111111111111111111" as Address;

describe("reviewed order authorization", () => {
  it("accepts only the reviewed wallet on Somnia Testnet", () => {
    expect(() => assertPlanAuthorization(
      reviewedWallet,
      reviewedWallet,
      somniaShannon.id,
    )).not.toThrow();
  });

  it("rejects a wallet change before any transaction is sent", () => {
    expect(() => assertPlanAuthorization(
      reviewedWallet,
      "0x2222222222222222222222222222222222222222",
      somniaShannon.id,
    )).toThrow(/wallet changed/i);
  });

  it("rejects a disconnected wallet or different network", () => {
    expect(() => assertPlanAuthorization(reviewedWallet, undefined, somniaShannon.id))
      .toThrow(/wallet changed/i);
    expect(() => assertPlanAuthorization(reviewedWallet, reviewedWallet, 1))
      .toThrow(/Somnia Testnet/i);
  });

  it("reports approval and order progress with distinct transaction hashes", async () => {
    const approvalHash = `0x${"a".repeat(64)}` as Hex;
    const orderHash = `0x${"b".repeat(64)}` as Hex;
    const pool = `0x${"2".repeat(40)}` as Address;
    const progress: string[] = [];
    const runtime = Object.create(BrowserDreamDexRuntime.prototype) as BrowserDreamDexRuntime;
    const waitForTransactionReceipt = vi.fn()
      .mockResolvedValueOnce({ status: "success", logs: [] })
      .mockResolvedValueOnce({ status: "success", logs: [] });
    const reviewedRouteMarket = vi.fn().mockResolvedValue({
      status: 1,
      expiry: BigInt(Math.floor(Date.now() / 1_000) + 3_600),
      pool,
    });
    const activeRouteMarket = vi.fn().mockRejectedValue(new Error("wrong route"));
    const primaryBundle = {
      id: "somnia-infrastructure",
      label: "Somnia infrastructure",
      indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
      httpRpcUrl: "https://api.infra.testnet.somnia.network",
      wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    };
    const secondaryBundle = {
      id: "dream-rpc",
      label: "Dream RPC",
      indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
      httpRpcUrl: "https://dream-rpc.somnia.network/",
      wsRpcUrl: "wss://dream-rpc.somnia.network/ws",
    };
    Object.assign(runtime as unknown as Record<string, unknown>, {
      config: {
        operatorId: 2,
        venueId: `0x${"9".repeat(64)}`,
        endpointBundles: [primaryBundle, secondaryBundle],
      },
      activeEndpointIndex: 1,
      connections: new Map([[0, {
        bundle: primaryBundle,
        exchange: {
          client: {
            getMarketOnchain: reviewedRouteMarket,
          },
        },
        publicClient: {
          estimateGas: vi.fn().mockResolvedValue(100_000n),
          waitForTransactionReceipt,
        },
      }], [1, {
        bundle: secondaryBundle,
        exchange: { client: { getMarketOnchain: activeRouteMarket } },
        publicClient: {},
      }]]),
      adapter: () => ({ verifyOrder: vi.fn().mockReturnValue({ transactionHash: orderHash }) }),
    });
    const sendTransaction = vi.fn()
      .mockResolvedValueOnce(approvalHash)
      .mockResolvedValueOnce(orderHash);
    const walletClient = {
      account: { address: reviewedWallet },
      chain: somniaShannon,
      sendTransaction,
    } as unknown as WalletClient;
    const plan = {
      account: reviewedWallet,
      endpointId: "somnia-infrastructure",
      market: {
        marketId: `0x${"3".repeat(64)}`,
        pool,
      },
      approval: {
        to: `0x${"4".repeat(40)}`,
        data: "0x095ea7b3",
        value: 0n,
        description: "Approve bounded collateral",
      },
      order: {
        to: pool,
        data: "0x1234",
        value: 0n,
        description: "Place DreamDEX order",
      },
    } as unknown as OrderPlan;

    await runtime.sendPlan(walletClient, plan, {
      onApprovalSubmitted: (hash) => progress.push(`approval-submitted:${hash}`),
      onApprovalConfirmed: (hash) => progress.push(`approval-confirmed:${hash}`),
      onOrderRequested: () => progress.push("order-requested"),
      onOrderSubmitted: (hash) => progress.push(`order-submitted:${hash}`),
    });

    expect(progress).toEqual([
      `approval-submitted:${approvalHash}`,
      `approval-confirmed:${approvalHash}`,
      "order-requested",
      `order-submitted:${orderHash}`,
    ]);
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(reviewedRouteMarket).toHaveBeenCalledTimes(1);
    expect(activeRouteMarket).not.toHaveBeenCalled();
  });
});
