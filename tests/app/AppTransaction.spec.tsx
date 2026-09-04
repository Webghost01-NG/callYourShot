import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, WalletClient } from "viem";
import type { LiveRound, OrderPlan, SendPlanProgress } from "../../src/app/runtime.js";

const account = `0x${"1".repeat(40)}` as Address;
const approvalHash = `0x${"a".repeat(64)}` as Hex;

const runtimeMocks = vi.hoisted(() => ({
  loadMarkets: vi.fn(),
  refreshRound: vi.fn(),
  prepareOrder: vi.fn(),
  sendPlan: vi.fn(),
  loadProfile: vi.fn(),
  close: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: account,
    chainId: 50_312,
    connector: { getProvider: vi.fn() },
    isConnected: true,
  }),
  useConnect: () => ({ connectors: [], connectAsync: vi.fn(), isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useWalletClient: () => ({ data: { account: { address: account } } as WalletClient }),
}));

vi.mock("../../src/app/runtime.js", () => ({
  BrowserDreamDexRuntime: class {
    loadMarkets = runtimeMocks.loadMarkets;
    refreshRound = runtimeMocks.refreshRound;
    prepareOrder = runtimeMocks.prepareOrder;
    sendPlan = runtimeMocks.sendPlan;
    loadProfile = runtimeMocks.loadProfile;
    close = runtimeMocks.close;
  },
}));

import { App } from "../../src/app/App.js";

const marketId = `0x${"2".repeat(64)}` as Hex;

function round(): LiveRound {
  return {
    market: {
      marketId,
      expirySec: BigInt(Math.floor(Date.now() / 1_000) + 3_600),
      pool: `0x${"3".repeat(40)}`,
      collateral: `0x${"4".repeat(40)}`,
      constraints: {
        tickSize: 1_000n,
        minQuantity: 1_000n,
        lotSize: 1_000n,
        priceScale: 1_000_000n,
      },
      indexed: {
        quoteDecimals: 6,
        question: "BTC closes at or above its opening price",
        asset: "BTC",
        intervalSec: "3600",
      },
    },
    book: {
      yesBids: [{ price: 600_000n, quantity: 10_000_000n }],
      yesAsks: [{ price: 610_000n, quantity: 10_000_000n }],
      noBids: [{ price: 390_000n, quantity: 10_000_000n }],
      noAsks: [{ price: 400_000n, quantity: 10_000_000n }],
    },
    collateralSymbol: "tUSDC",
  } as LiveRound;
}

function plan(): OrderPlan {
  const live = round();
  return {
    account,
    market: live.market,
    side: "BUY_YES",
    yesPrice: 620_000n,
    selectedLimitPrice: 620_000n,
    quantity: 1_500_000n,
    maximumCost: 930_000n,
    approval: {
      to: live.market.collateral,
      data: "0x095ea7b3",
      value: 0n,
      description: "Approve bounded collateral",
    },
    order: {
      to: live.market.pool,
      data: "0x1234",
      value: 0n,
      description: "Place DreamDEX order",
    },
  };
}

async function openWalletReview() {
  await userEvent.click(await screen.findByRole("button", { name: "Review UP call" }, { timeout: 5_000 }));
  await userEvent.click(await screen.findByRole("button", { name: "Confirm in wallet" }, { timeout: 5_000 }));
}

describe("wallet transaction lifecycle", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DREAMDEX_OPERATOR_ID", "2");
    vi.stubEnv("VITE_DREAMDEX_VENUE_ID", `0x${"5".repeat(64)}`);
    runtimeMocks.loadMarkets.mockReset().mockResolvedValue({
      rounds: [round()],
      rejectedCount: 0,
      truncated: false,
    });
    runtimeMocks.refreshRound.mockReset().mockResolvedValue(round());
    runtimeMocks.prepareOrder.mockReset().mockResolvedValue(plan());
    runtimeMocks.sendPlan.mockReset();
    runtimeMocks.loadProfile.mockReset().mockResolvedValue(undefined);
    runtimeMocks.close.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("renders a concise first-approval cancellation without provider internals", async () => {
    runtimeMocks.sendPlan.mockRejectedValue(new Error(
      "User rejected the request. Request Arguments: data: 0x095ea7b3000000000000000000000000 gas: 1667540 Details: User denied transaction signature. Version: viem@2.56.3",
    ));
    render(<App />);

    await openWalletReview();

    expect(await screen.findByText("Approval cancelled")).toBeTruthy();
    expect(screen.getByText(/Nothing was submitted, no gas was spent, and no funds moved/i)).toBeTruthy();
    expect(screen.queryByText(/Request Arguments|viem@|0x095ea7/i)).toBeNull();
  }, 10_000);

  it("keeps the approval receipt and warning when the later order is cancelled", async () => {
    runtimeMocks.sendPlan.mockImplementation(async (
      _wallet: WalletClient,
      _plan: OrderPlan,
      progress: SendPlanProgress,
    ) => {
      progress.onApprovalSubmitted(approvalHash);
      progress.onApprovalConfirmed(approvalHash);
      progress.onOrderRequested();
      throw Object.assign(new Error("User denied transaction signature."), { code: 4001 });
    });
    render(<App />);

    await openWalletReview();

    expect(await screen.findByText("Order cancelled")).toBeTruthy();
    expect(screen.getByText(/bounded token approval succeeded/i)).toBeTruthy();
    const approvalLink = screen.getByRole("link", { name: /View approval transaction/i });
    expect(approvalLink.getAttribute("href")).toContain(approvalHash);
    await waitFor(() => expect(runtimeMocks.sendPlan).toHaveBeenCalledTimes(1));
  }, 10_000);
});
