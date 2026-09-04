import type { Hex } from "viem";

export interface PublicAppConfig {
  operatorId: number;
  venueId: Hex;
  indexerUrl: string;
  wsRpcUrl: string;
  httpRpcUrl: string;
}

const DEFAULT_INDEXER = "https://dev.smk.somnia.host/v1/graphql";
const DEFAULT_WS_RPC = "wss://api.infra.testnet.somnia.network/ws";
const DEFAULT_HTTP_RPC = "https://dream-rpc.somnia.network/";

export function readPublicConfig(env: ImportMetaEnv): PublicAppConfig {
  const operatorText = env.VITE_DREAMDEX_OPERATOR_ID?.trim();
  const venueId = env.VITE_DREAMDEX_VENUE_ID?.trim();
  if (!operatorText || !venueId) {
    throw new Error("DreamDEX operator and venue configuration is required.");
  }
  const operatorId = Number(operatorText);
  if (!Number.isSafeInteger(operatorId) || operatorId < 0) {
    throw new Error("DreamDEX operator ID must be a non-negative integer.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(venueId)) {
    throw new Error("DreamDEX venue ID must be a bytes32 value.");
  }
  return {
    operatorId,
    venueId: venueId as Hex,
    indexerUrl: env.VITE_DREAMDEX_INDEXER_URL?.trim() || DEFAULT_INDEXER,
    wsRpcUrl: env.VITE_SOMNIA_WS_RPC_URL?.trim() || DEFAULT_WS_RPC,
    httpRpcUrl: DEFAULT_HTTP_RPC,
  };
}
