import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, EIP1193Provider } from "viem";
import type { LiveRound } from "../../src/app/runtime.js";

const runtimeMocks = vi.hoisted(() => ({
  loadRound: vi.fn(),
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
    loadRound = runtimeMocks.loadRound;
    close = runtimeMocks.close;
  },
}));

import { App, resolveConnectedWallet } from "../../src/app/App.js";

const marketId = `0x${"1".repeat(64)}`;

function liveRound(expirySec: bigint, question = "BTC closes at or above its opening price"): LiveRound {
  return {
    market: {
      marketId,
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
      },
    },
    book: {
      yesBids: [{ price: 600_000n, quantity: 10_000_000n }],
      yesAsks: [{ price: 610_000n, quantity: 10_000_000n }],
      noBids: [{ price: 390_000n, quantity: 10_000_000n }],
      noAsks: [{ price: 400_000n, quantity: 10_000_000n }],
    },
  } as LiveRound;
}

describe("live round resilience", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DREAMDEX_OPERATOR_ID", "2");
    vi.stubEnv("VITE_DREAMDEX_VENUE_ID", `0x${"2".repeat(64)}`);
    runtimeMocks.loadRound.mockReset();
    runtimeMocks.close.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("exposes the selected direction to assistive technology", async () => {
    runtimeMocks.loadRound.mockResolvedValue(liveRound(BigInt(Math.floor(Date.now() / 1_000) + 900)));
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
    runtimeMocks.loadRound.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<App />);

    expect(await screen.findByText("First live round", {}, { timeout: 5_000 })).toBeTruthy();
    expect(await screen.findByText("Next live round", {}, { timeout: 6_000 })).toBeTruthy();
    expect(runtimeMocks.loadRound).toHaveBeenCalledTimes(2);
  }, 10_000);
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
