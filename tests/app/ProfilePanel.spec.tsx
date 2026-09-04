import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { ProfilePanel } from "../../src/app/ProfilePanel.js";
import type { ReconciledProfile } from "../../src/dreamdex/reconciliation.js";

const fillHash = `0x${"1".repeat(64)}` as Hex;
const marketId = `0x${"2".repeat(64)}` as Hex;

function result(): ReconciledProfile {
  return {
    snapshotTimestampSec: 1_000n,
    evidenceGaps: [{
      marketId,
      kind: "oracle",
      message: "Oracle transaction link unavailable.",
    }],
    profile: {
      account: "0x3333333333333333333333333333333333333333" as Address,
      formulaVersion: "CYS-EDGE-v1",
      state: "provisional",
      rounds: [{
        marketId,
        question: "BTC closes at or above its opening price",
        side: "UP",
        fillTransactionHash: fillHash,
        settlementTransactionHash: null,
        oracleTransactionHash: null,
        timestampSec: 100n,
        quantity: 1_000_000n,
        weightedPriceNumerator: 400_000_000_000n,
        confidence: { numerator: 2n, denominator: 5n },
        state: "won",
        roundPoints: { numerator: 60n, denominator: 1n },
        entryCostRaw: 400_000n,
        payoutRaw: 1_000_000n,
        returnRaw: 600_000n,
      }],
      settledCount: 1,
      wins: 1,
      accuracy: { numerator: 1n, denominator: 1n },
      currentStreak: 1,
      bestStreak: 1,
      totalReturnRaw: 600_000n,
      maximumDrawdownRaw: 0n,
      collateral: "0x4444444444444444444444444444444444444444" as Address,
      collateralDecimals: 6,
      skillScore: { numerator: 80n, denominator: 1n },
    },
  };
}

describe("verified profile panel", () => {
  it("shows derived metrics, real fill proof, and missing-link states", () => {
    render(<ProfilePanel connected state="ready" result={result()} onRefresh={() => undefined} />);
    expect(screen.getByText("80.00")).toBeTruthy();
    expect(screen.getByText("Provisional · 9 more to rank")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fill receipt/ }).getAttribute("href")).toContain(fillHash);
    expect(screen.getByText("Final-result link unavailable")).toBeTruthy();
    expect(screen.getByText("Oracle link unavailable")).toBeTruthy();
  });
});
