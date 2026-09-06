import { describe, expect, it, vi } from "vitest";
import type { DreamDexEndpointBundle } from "../../src/app/config.js";
import {
  assertEndpointHealth,
  attemptEndpointBundles,
  MAX_ENDPOINT_SNAPSHOT_SKEW_BLOCKS,
} from "../../src/app/endpointFailover.js";

const bundles: readonly DreamDexEndpointBundle[] = [{
  id: "somnia-infrastructure",
  label: "Somnia infrastructure",
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  httpRpcUrl: "https://api.infra.testnet.somnia.network",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
}, {
  id: "dream-rpc",
  label: "Dream RPC",
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  httpRpcUrl: "https://dream-rpc.somnia.network/",
  wsRpcUrl: "wss://dream-rpc.somnia.network/ws",
}];

describe("verified endpoint failover", () => {
  it("accepts a coherent Shannon indexer and RPC snapshot", () => {
    expect(assertEndpointHealth({
      bundle: bundles[0]!,
      expectedChainId: 50_312,
      rpcChainId: 50_312,
      rpcBlock: 100_050n,
      indexerStatus: {
        chainId: 50_312,
        latestProcessedBlock: 100_000,
        blockHeight: 100_000,
        numEventsProcessed: 1,
      },
    })).toMatchObject({ endpointId: "somnia-infrastructure", skewBlocks: 50n });
  });

  it("rejects a wrong chain or incoherent snapshot", () => {
    expect(() => assertEndpointHealth({
      bundle: bundles[0]!,
      expectedChainId: 50_312,
      rpcChainId: 1,
      rpcBlock: 100n,
      indexerStatus: null,
    })).toThrow(/wrong chain ID/i);
    expect(() => assertEndpointHealth({
      bundle: bundles[0]!,
      expectedChainId: 50_312,
      rpcChainId: 50_312,
      rpcBlock: MAX_ENDPOINT_SNAPSHOT_SKEW_BLOCKS + 1n,
      indexerStatus: {
        chainId: 50_312,
        latestProcessedBlock: 0,
        blockHeight: 0,
        numEventsProcessed: 1,
      },
    })).toThrow(/too far apart/i);
  });

  it("moves to the next complete bundle after a bounded failure", async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce("verified");

    await expect(attemptEndpointBundles({ bundles, startingIndex: 0, attempt })).resolves.toEqual({
      value: "verified",
      index: 1,
      failedAttempts: 1,
    });
    expect(attempt.mock.calls.map((call) => call[0].id)).toEqual([
      "somnia-infrastructure",
      "dream-rpc",
    ]);
  });

  it("does not let a hanging primary prevent the second route", async () => {
    const result = await attemptEndpointBundles({
      bundles,
      startingIndex: 0,
      deadlineMs: 5,
      attempt: async (_bundle, index) => index === 0
        ? new Promise<string>(() => undefined)
        : "recovered",
    });

    expect(result).toEqual({ value: "recovered", index: 1, failedAttempts: 1 });
  });

  it("never reports success when every verified bundle fails", async () => {
    await expect(attemptEndpointBundles({
      bundles,
      startingIndex: 1,
      attempt: async (bundle) => { throw new Error(`${bundle.label} unavailable`); },
    })).rejects.toThrow(/Somnia infrastructure unavailable/i);
  });
});
