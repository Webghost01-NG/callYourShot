import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { assertPlanAuthorization } from "../../src/app/runtime.js";

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
});
