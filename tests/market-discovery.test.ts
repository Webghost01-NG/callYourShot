import assert from "node:assert/strict";
import test from "node:test";
import type { BinaryMarket, MarketOnchain, SomniaMarketsClient } from "@somnia-chain/markets-sdk";
import type { Address, Hex } from "viem";
import { DreamDexAdapter } from "../src/dreamdex/adapter.js";

const venueId = `0x${"1".repeat(64)}` as Hex;
const pool = `0x${"2".repeat(40)}` as Address;
const marketAddress = `0x${"3".repeat(40)}` as Address;
const collateral = `0x${"4".repeat(40)}` as Address;
const outcomeToken = `0x${"5".repeat(40)}` as Address;

function indexedMarket(index: number, overrides: Partial<BinaryMarket> = {}): BinaryMarket {
  return {
    marketId: `0x${index.toString(16).padStart(64, "0")}`,
    operatorId: 7,
    venueId,
    asset: index % 2 === 0 ? "ETH" : "BTC",
    question: "Will this market close higher?",
    intervalSec: index % 2 === 0 ? "300" : "900",
    quoteDecimals: 6,
    poolAddress: pool,
    marketAddress,
    collateral,
    yesTokenId: "1",
    noTokenId: "2",
    ...overrides,
  } as BinaryMarket;
}

function onchain(status = 1): MarketOnchain {
  return {
    status,
    expiry: 2_000n,
    pool,
    marketAddress,
    collateral,
    decimals: 6,
    outcomeToken,
    yesId: 1n,
    noId: 2n,
  } as unknown as MarketOnchain;
}

function adapter(client: Partial<SomniaMarketsClient>) {
  return new DreamDexAdapter(
    client as SomniaMarketsClient,
    undefined,
    marketAddress,
    async () => ({ tickSize: 1n, minQuantity: 1n, lotSize: 1n, priceScale: 1_000_000n }),
    () => 1_000n,
  );
}

const criteria = {
  origin: { operatorId: 7, venueId },
  minimumHeadroomSec: 45n,
};

test("discovers multiple assets without sending asset or cadence filters", async () => {
  const filters: Record<string, unknown>[] = [];
  const client = {
    listLiveBinaryMarkets: async (filter: Record<string, unknown>) => {
      filters.push(filter);
      return [indexedMarket(1), indexedMarket(2)];
    },
    getMarketOnchain: async () => onchain(),
  };
  const result = await adapter(client).discoverMarkets(criteria);
  assert.deepEqual(result.markets.map((market) => market.indexed.asset), ["BTC", "ETH"]);
  assert.equal(filters[0]?.asset, undefined);
  assert.equal(filters[0]?.intervalSec, undefined);
  assert.equal(filters[0]?.operatorId, 7);
  assert.equal(filters[0]?.venueId, venueId);
  assert.equal(filters[0]?.limit, 25);
  assert.equal(filters[0]?.offset, 0);
});

test("rejects wrong-origin and non-trading candidates without hiding valid markets", async () => {
  const lockedId = indexedMarket(2).marketId;
  const client = {
    listLiveBinaryMarkets: async () => [
      indexedMarket(1, { operatorId: 8 }),
      indexedMarket(2),
      indexedMarket(3),
    ],
    getMarketOnchain: async (marketId: string) => onchain(marketId === lockedId ? 2 : 1),
  };
  const result = await adapter(client).discoverMarkets(criteria);
  assert.deepEqual(result.markets.map((market) => market.marketId), [indexedMarket(3).marketId]);
  assert.equal(result.rejectedCount, 2);
});

test("rejects indexed bindings that disagree with the market module", async () => {
  const mismatched = indexedMarket(1, {
    poolAddress: `0x${"9".repeat(40)}` as Address,
  });
  await assert.rejects(
    adapter({
      listLiveBinaryMarkets: async () => [mismatched],
      getMarketOnchain: async () => onchain(),
    }).discoverMarkets(criteria),
    /No eligible live DreamDEX Event Contract/,
  );
});

test("refreshes the exact selected market instead of silently switching events", async () => {
  const selected = indexedMarket(9);
  const client = {
    getBinaryMarket: async () => selected,
    getMarketOnchain: async () => onchain(),
  };
  const result = await adapter(client).discoverMarketById(criteria, selected.marketId as Hex);
  assert.equal(result.marketId, selected.marketId);

  const wrongOrigin = adapter({
    getBinaryMarket: async () => indexedMarket(10, { operatorId: 99 }),
    getMarketOnchain: async () => onchain(),
  });
  await assert.rejects(
    wrongOrigin.discoverMarketById(criteria, indexedMarket(10).marketId as Hex),
    /no longer tradable/,
  );
});

test("caps the lobby without reporting valid overflow candidates as rejected", async () => {
  const candidates = Array.from({ length: 15 }, (_, index) => indexedMarket(index + 1));
  candidates[2] = indexedMarket(3, { operatorId: 99 });
  const result = await adapter({
    listLiveBinaryMarkets: async () => candidates,
    getMarketOnchain: async () => onchain(),
  }).discoverMarkets(criteria);

  assert.equal(result.markets.length, 12);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.truncated, true);
});

test("keeps a verified partial page when a later indexer page fails", async () => {
  const firstPage = Array.from({ length: 25 }, (_, index) => indexedMarket(index + 1, {
    operatorId: index === 0 ? 7 : 99,
  }));
  const result = await adapter({
    listLiveBinaryMarkets: async ({ offset }: { offset?: number }) => {
      if (offset === 0) return firstPage;
      throw new Error("second page unavailable");
    },
    getMarketOnchain: async () => onchain(),
  }).discoverMarkets(criteria);

  assert.equal(result.markets.length, 1);
  assert.equal(result.rejectedCount, 24);
  assert.equal(result.truncated, true);
});
