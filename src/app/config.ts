import type { Hex } from "viem";

export interface PublicAppConfig {
  operatorId: number;
  venueId: Hex;
  indexerUrl: string;
  wsRpcUrl: string;
  httpRpcUrl: string;
  endpointBundles: readonly DreamDexEndpointBundle[];
}

export interface DreamDexEndpointBundle {
  id: "somnia-infrastructure" | "dream-rpc";
  label: string;
  indexerUrl: string;
  wsRpcUrl: string;
  httpRpcUrl: string;
}

const DEFAULT_INDEXER = "https://dev.smk.somnia.host/v1/graphql";
const OFFICIAL_ENDPOINTS: readonly DreamDexEndpointBundle[] = [{
  id: "somnia-infrastructure",
  label: "Somnia infrastructure",
  indexerUrl: DEFAULT_INDEXER,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  httpRpcUrl: "https://api.infra.testnet.somnia.network",
}, {
  id: "dream-rpc",
  label: "Dream RPC",
  indexerUrl: DEFAULT_INDEXER,
  wsRpcUrl: "wss://dream-rpc.somnia.network/ws",
  httpRpcUrl: "https://dream-rpc.somnia.network/",
}];

function normalizedEndpoint(value: string): string {
  return value.replace(/\/$/, "").toLowerCase();
}

function preferredEndpointId(env: ImportMetaEnv): DreamDexEndpointBundle["id"] | undefined {
  const requested = [
    env.VITE_SOMNIA_HTTP_RPC_URL?.trim(),
    env.VITE_SOMNIA_WS_RPC_URL?.trim(),
  ].filter((value): value is string => Boolean(value));
  if (requested.length === 0) return undefined;
  const matching = OFFICIAL_ENDPOINTS.filter((bundle) => requested.every((value) =>
    normalizedEndpoint(bundle.httpRpcUrl) === normalizedEndpoint(value)
    || normalizedEndpoint(bundle.wsRpcUrl) === normalizedEndpoint(value),
  ));
  if (matching.length !== 1) {
    throw new Error("Somnia endpoint overrides must identify one official Shannon RPC bundle.");
  }
  return matching[0]!.id;
}

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
  const requestedIndexer = env.VITE_DREAMDEX_INDEXER_URL?.trim();
  if (requestedIndexer && normalizedEndpoint(requestedIndexer) !== normalizedEndpoint(DEFAULT_INDEXER)) {
    throw new Error("Only the official DreamDEX Shannon indexer is supported.");
  }
  const preferredId = preferredEndpointId(env);
  const endpointBundles = preferredId
    ? [...OFFICIAL_ENDPOINTS].sort((left, right) =>
        left.id === preferredId ? -1 : right.id === preferredId ? 1 : 0)
    : [...OFFICIAL_ENDPOINTS];
  const primary = endpointBundles[0]!;
  return {
    operatorId,
    venueId: venueId as Hex,
    indexerUrl: primary.indexerUrl,
    wsRpcUrl: primary.wsRpcUrl,
    httpRpcUrl: primary.httpRpcUrl,
    endpointBundles,
  };
}
