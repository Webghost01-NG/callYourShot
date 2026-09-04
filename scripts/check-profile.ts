import {
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { DreamDexProfileReconciler } from "../src/dreamdex/reconciliation.js";

const account = process.env.PROFILE_ACCOUNT;
const operatorText = process.env.DREAMDEX_OPERATOR_ID;
const venueId = process.env.DREAMDEX_VENUE_ID;
if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
  throw new Error("PROFILE_ACCOUNT must be a public wallet address");
}
if (!operatorText || !venueId) {
  throw new Error("DREAMDEX_OPERATOR_ID and DREAMDEX_VENUE_ID are required");
}
const operatorId = Number(operatorText);
if (!Number.isSafeInteger(operatorId) || operatorId < 0) {
  throw new Error("DREAMDEX_OPERATOR_ID must be a non-negative integer");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(venueId)) {
  throw new Error("DREAMDEX_VENUE_ID must be a bytes32 value");
}

const rpcUrl = process.env.SOMNIA_HTTP_RPC_URL ?? "https://dream-rpc.somnia.network/";
const exchange = new SomniaMarkets({
  indexerUrl: process.env.DREAMDEX_INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: process.env.SOMNIA_WS_RPC_URL ?? "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const walletClient = createWalletClient({
  account: account as Address,
  chain: somniaShannon,
  transport: http(rpcUrl),
});
const trader = exchange.client.createTrader({ walletClient, account: account as Address });
const reconciler = new DreamDexProfileReconciler(
  exchange.client,
  async (marketId) => {
    const settlement = await trader.getSettlement(marketId);
    if (!settlement) throw new Error("permanent settlement record was not found");
    return settlement;
  },
);

try {
  const result = await reconciler.reconcile(account as Address, {
    asset: "BTC",
    intervalSec: 900,
    origin: { operatorId, venueId: venueId as Hex },
  });
  process.stdout.write(`${JSON.stringify(result, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value, 2)}\n`);
} finally {
  await exchange.close();
}
