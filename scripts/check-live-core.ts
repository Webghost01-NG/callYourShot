import {
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { DreamDexAdapter } from "../src/dreamdex/adapter.js";

const indexerUrl = process.env.DREAMDEX_INDEXER_URL
  ?? "https://dev.smk.somnia.host/v1/graphql";
const wsRpcUrl = process.env.SOMNIA_WS_RPC_URL
  ?? "wss://api.infra.testnet.somnia.network/ws";
const httpRpcUrl = process.env.SOMNIA_HTTP_RPC_URL
  ?? "https://dream-rpc.somnia.network/";
const operatorText = process.env.DREAMDEX_OPERATOR_ID;
const venueId = process.env.DREAMDEX_VENUE_ID;
const binaryModule = SOMNIA_TESTNET_ADDRESSES.binaryModule;

if (!operatorText || !venueId) {
  throw new Error(
    "DREAMDEX_OPERATOR_ID and DREAMDEX_VENUE_ID are required trusted-origin inputs",
  );
}
if (!binaryModule) throw new Error("SDK testnet binary module is unavailable");
const operatorId = Number.parseInt(operatorText, 10);
if (!Number.isSafeInteger(operatorId) || operatorId < 0) {
  throw new Error("DREAMDEX_OPERATOR_ID must be a non-negative integer");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(venueId)) {
  throw new Error("DREAMDEX_VENUE_ID must be a bytes32 hex value");
}

const exchange = new SomniaMarkets({
  indexerUrl,
  chain: somniaShannon,
  wsRpcUrl,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const publicClient = createPublicClient({
  chain: somniaShannon,
  transport: http(httpRpcUrl),
});
const bookParametersAbi = parseAbi([
  "function getOrderBookParameters() view returns (uint256 tickSize, uint256 minQuantity, uint256 lotSize)",
]);

const adapter = new DreamDexAdapter(
  exchange.client,
  undefined,
  binaryModule,
  async (pool: Address, priceScale: bigint) => {
    const [tickSize, minQuantity, lotSize] = await publicClient.readContract({
      address: pool,
      abi: bookParametersAbi,
      functionName: "getOrderBookParameters",
    });
    return { tickSize, minQuantity, lotSize, priceScale };
  },
);

const market = await adapter.discoverMarket({
  asset: process.env.VALIDATION_ASSET ?? "BTC",
  intervalSec: Number.parseInt(process.env.VALIDATION_INTERVAL_SEC ?? "900", 10),
  origin: { operatorId, venueId },
  minimumHeadroomSec: 30n,
});
const book = await exchange.client.getBinaryOrderBook(market.pool, {
  decimals: market.indexed.quoteDecimals,
  depth: 3,
});

const report = JSON.stringify({
  checkedAt: new Date().toISOString(),
  chainId: somniaShannon.id,
  marketId: market.marketId,
  pool: market.pool,
  origin: {
    operatorId: market.indexed.operatorId,
    venueId: market.indexed.venueId,
  },
  status: market.onchain.status,
  expiry: market.expirySec.toString(),
  constraints: Object.fromEntries(
    Object.entries(market.constraints).map(([key, value]) => [key, value.toString()]),
  ),
  bookLevels: {
    yesBids: book.yesBids.length,
    yesAsks: book.yesAsks.length,
    noBids: book.noBids.length,
    noAsks: book.noAsks.length,
  },
}, null, 2);

await exchange.close();
// The SDK stops live machinery but does not expose its lazy viem transport for
// disposal after one-shot chain reads. Flush the report before ending this CLI.
process.stdout.write(`${report}\n`, () => process.exit(0));
