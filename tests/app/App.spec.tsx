import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, EIP1193Provider } from "viem";
import type { LiveRound } from "../../src/app/runtime.js";

const runtimeMocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  loadMarkets: vi.fn(),
  refreshRound: vi.fn(),
  close: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, chainId: undefined, isConnected: false }),
  useConnect: () => ({ connectors: [{}], connectAsync: vi.fn(), isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useWalletClient: () => ({ data: undefined }),
}));

vi.mock("../../src/app/runtime.js", () => ({
  BrowserDreamDexRuntime: class {
    constructor() {
      runtimeMocks.constructed();
    }
    loadMarkets = runtimeMocks.loadMarkets;
    refreshRound = runtimeMocks.refreshRound;
    close = runtimeMocks.close;
  },
}));

import { App, resolveConnectedWallet } from "../../src/app/App.js";
import { MARKET_DISCOVERY_DEADLINE_MS } from "../../src/app/marketDiscovery.js";

const marketId = `0x${"1".repeat(64)}`;

function liveRound(
  expirySec: bigint,
  question = "BTC closes at or above its opening price",
  options: { id?: string; asset?: string; intervalSec?: string } = {},
): LiveRound {
  return {
    market: {
      marketId: options.id ?? marketId,
      expirySec,
      constraints: {
        tickSize: 1_000n,
        minQuantity: 1_000n,
        lotSize: 1_000n,
        priceScale: 1_000_000n,
      },
      indexed: {
        quoteDecimals: 6,
        question,
        asset: options.asset ?? "BTC",
        intervalSec: options.intervalSec ?? "900",
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

describe("live round resilience", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DREAMDEX_OPERATOR_ID", "2");
    vi.stubEnv("VITE_DREAMDEX_VENUE_ID", `0x${"2".repeat(64)}`);
    runtimeMocks.constructed.mockReset();
    runtimeMocks.loadMarkets.mockReset();
    runtimeMocks.refreshRound.mockReset();
    runtimeMocks.close.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("exposes the selected direction to assistive technology", async () => {
    runtimeMocks.loadMarkets.mockResolvedValue({
      rounds: [liveRound(BigInt(Math.floor(Date.now() / 1_000) + 900))],
      rejectedCount: 0,
      truncated: false,
    });
    render(<App />);

    const higher = await screen.findByRole("button", { name: /Higher/ }, { timeout: 5_000 });
    const lower = screen.getByRole("button", { name: /Lower/ });
    expect(higher.getAttribute("aria-pressed")).toBe("true");
    expect(lower.getAttribute("aria-pressed")).toBe("false");
  });

  it("rediscovers the market after the displayed round locks", async () => {
    const nowSec = BigInt(Math.floor(Date.now() / 1_000));
    const first = liveRound(nowSec + 2n, "First live round");
    const second = liveRound(nowSec + 900n, "Next live round");
    runtimeMocks.loadMarkets
      .mockResolvedValueOnce({ rounds: [first], rejectedCount: 0, truncated: false })
      .mockResolvedValueOnce({ rounds: [second], rejectedCount: 0, truncated: false });
    render(<App />);

    expect((await screen.findAllByText("First live round", {}, { timeout: 5_000 })).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Next live round", {}, { timeout: 6_000 })).length).toBeGreaterThan(0);
    expect(runtimeMocks.loadMarkets).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("lets the user switch between live Event Contracts without rediscovering", async () => {
    const expiry = BigInt(Math.floor(Date.now() / 1_000) + 900);
    const btc = liveRound(expiry);
    const eth = liveRound(expiry, "ETH closes at or above its opening price", {
      id: `0x${"3".repeat(64)}`,
      asset: "ETH",
      intervalSec: "300",
    });
    runtimeMocks.loadMarkets.mockResolvedValue({
      rounds: [btc, eth],
      rejectedCount: 0,
      truncated: false,
    });
    render(<App />);

    const ethOption = await screen.findByRole("button", { name: /ETH.*5m.*ETH closes/i });
    await userEvent.click(ethOption);

    expect(ethOption.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("ETH · 5m")).toBeTruthy();
    expect(runtimeMocks.loadMarkets).toHaveBeenCalledTimes(1);
  });

  it("uses YES and NO language for a non-directional event", async () => {
    const event = liveRound(
      BigInt(Math.floor(Date.now() / 1_000) + 900),
      "Will the protocol proposal pass?",
      { asset: "GOV", intervalSec: "3600" },
    );
    runtimeMocks.loadMarkets.mockResolvedValue({
      rounds: [event],
      rejectedCount: 2,
      truncated: true,
    });
    render(<App />);

    expect(await screen.findByRole("button", { name: /Yes.*YES contract/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /No.*NO contract/i })).toBeTruthy();
    expect(screen.getByText(/2 candidates were excluded/i)).toBeTruthy();
    expect(screen.getByText(/bounded market list has more results/i)).toBeTruthy();
  });

  it("retires a timed-out runtime and recovers with a fresh instance", async () => {
    vi.useFakeTimers();
    const oldRound = liveRound(
      BigInt(Math.floor(Date.now() / 1_000) + 900),
      "Old result that arrived too late",
    );
    const recoveredRound = liveRound(
      BigInt(Math.floor(Date.now() / 1_000) + 900),
      "Recovered live market",
      { id: `0x${"4".repeat(64)}` },
    );
    let resolveOldRequest!: (value: {
      rounds: LiveRound[];
      rejectedCount: number;
      truncated: boolean;
    }) => void;
    runtimeMocks.loadMarkets
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOldRequest = resolve;
      }))
      .mockResolvedValueOnce({ rounds: [recoveredRound], rejectedCount: 0, truncated: false });

    const { unmount } = render(<App />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runtimeMocks.loadMarkets).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKET_DISCOVERY_DEADLINE_MS);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/market discovery timed out/i);
    expect(runtimeMocks.close).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh markets" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runtimeMocks.constructed).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.loadMarkets).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("Recovered live market").length).toBeGreaterThan(0);

    await act(async () => {
      resolveOldRequest({ rounds: [oldRound], rejectedCount: 0, truncated: false });
      await Promise.resolve();
    });
    expect(screen.queryByText("Old result that arrived too late")).toBeNull();
    expect(screen.getAllByText("Recovered live market").length).toBeGreaterThan(0);

    unmount();
    expect(runtimeMocks.close).toHaveBeenCalledTimes(2);
  });
});

describe("wallet connection resolution", () => {
  it("reuses an already-connected account without reconnecting", async () => {
    const address = `0x${"1".repeat(40)}` as Address;
    const connect = vi.fn();
    const request = vi.fn();
    const getProvider = vi.fn().mockResolvedValue({
      request,
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as EIP1193Provider);

    const connection = await resolveConnectedWallet({
      currentAddress: address,
      currentChainId: 50_312,
      connect,
      getProvider,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(getProvider).toHaveBeenCalledWith(50_312);
    expect(connection.address).toBe(address);
    expect(connection.walletClient.account?.address).toBe(address);
  });
});
