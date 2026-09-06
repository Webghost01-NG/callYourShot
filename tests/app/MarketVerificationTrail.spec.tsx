import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { MarketVerificationTrail } from "../../src/app/MarketVerificationTrail.js";
import type { LiveRound } from "../../src/app/runtime.js";
import type { VerifiedExecution } from "../../src/core/execution.js";

const marketId = `0x${"1".repeat(64)}` as Hex;
const marketAddress = `0x${"2".repeat(40)}` as Address;
const pool = `0x${"3".repeat(40)}` as Address;
const collateral = `0x${"4".repeat(40)}` as Address;
const fillHash = `0x${"5".repeat(64)}` as Hex;
const venueId = `0x${"6".repeat(64)}`;

function round(): LiveRound {
  return {
    market: {
      marketId,
      marketAddress,
      pool,
      collateral,
      expirySec: 1_000n,
      constraints: {
        tickSize: 1_000n,
        minQuantity: 1_000_000n,
        lotSize: 1_000_000n,
        priceScale: 1_000_000n,
      },
      indexed: {
        operatorId: 2,
        venueId,
        quoteDecimals: 6,
      },
    },
    book: {
      yesBids: [],
      yesAsks: [{ price: 400_000n, quantity: 1_000_000n }],
      noBids: [],
      noAsks: [
        { price: 600_000n, quantity: 1_000_000n },
        { price: 610_000n, quantity: 1_000_000n },
      ],
    },
    collateralSymbol: "tUSDC",
  } as unknown as LiveRound;
}

function execution(): VerifiedExecution {
  return {
    transactionHash: fillHash,
    fills: [{ takerOrderId: 1n, makerOrderId: 2n, quantity: 1_000_000n, price: 400_000n }],
    totalQuantity: 1_000_000n,
    weightedPriceNumerator: 400_000_000_000n,
    averageFillPrice: 400_000n,
  };
}

describe("DreamDEX verification trail", () => {
  it("keeps technical evidence collapsed until requested", () => {
    const { container } = render(<MarketVerificationTrail round={round()} />);
    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("DreamDEX verification trail"));

    expect(details?.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/operator 2/i)).toBeTruthy();
    expect(screen.getByText(venueId)).toBeTruthy();
    expect(screen.getByText(marketId)).toBeTruthy();
    expect(screen.getByText(/1 YES and 2 NO sell levels/i)).toBeTruthy();
    expect(screen.getByText("Waiting for a real fill")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Market contract/ }).getAttribute("href")).toContain(marketAddress);
    expect(screen.getByRole("link", { name: /Active pool/ }).getAttribute("href")).toContain(pool);
  });

  it("reveals a decoded fill only when verified execution is present", () => {
    render(<MarketVerificationTrail round={round()} execution={execution()} />);

    expect(screen.getByText("Real fill event decoded")).toBeTruthy();
    expect(screen.getByText(/1 fill event was decoded/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Verify fill transaction/ }).getAttribute("href")).toContain(fillHash);
  });
});
