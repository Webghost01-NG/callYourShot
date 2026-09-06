import type { IndexerSyncStatus } from "@somnia-chain/markets-sdk";
import type { DreamDexEndpointBundle } from "./config.js";

export const MAX_ENDPOINT_SNAPSHOT_SKEW_BLOCKS = 3_000n;
export const ENDPOINT_ATTEMPT_DEADLINE_MS = 8_000;

export interface EndpointDiagnostics {
  endpointId: DreamDexEndpointBundle["id"];
  endpointLabel: string;
  rpcBlock: bigint;
  indexerBlock: bigint;
  skewBlocks: bigint;
  failedAttempts: number;
}

export function assertEndpointHealth(input: {
  bundle: DreamDexEndpointBundle;
  expectedChainId: number;
  rpcChainId: number;
  rpcBlock: bigint;
  indexerStatus: IndexerSyncStatus | null;
}): Omit<EndpointDiagnostics, "failedAttempts"> {
  if (input.rpcChainId !== input.expectedChainId) {
    throw new Error(`${input.bundle.label} returned the wrong chain ID.`);
  }
  const indexerBlockNumber = input.indexerStatus?.latestProcessedBlock;
  if (
    input.indexerStatus?.chainId !== input.expectedChainId
    || indexerBlockNumber === null
    || indexerBlockNumber === undefined
  ) {
    throw new Error("The official DreamDEX indexer has no usable Shannon sync status.");
  }
  const indexerBlock = BigInt(indexerBlockNumber);
  const skewBlocks = input.rpcBlock >= indexerBlock
    ? input.rpcBlock - indexerBlock
    : indexerBlock - input.rpcBlock;
  if (skewBlocks > MAX_ENDPOINT_SNAPSHOT_SKEW_BLOCKS) {
    throw new Error("The DreamDEX indexer and Somnia RPC are too far apart for a coherent snapshot.");
  }
  return {
    endpointId: input.bundle.id,
    endpointLabel: input.bundle.label,
    rpcBlock: input.rpcBlock,
    indexerBlock,
    skewBlocks,
  };
}

export async function attemptEndpointBundles<T>(input: {
  bundles: readonly DreamDexEndpointBundle[];
  startingIndex: number;
  attempt: (bundle: DreamDexEndpointBundle, index: number) => Promise<T>;
  deadlineMs?: number;
}): Promise<{ value: T; index: number; failedAttempts: number }> {
  if (input.bundles.length === 0) throw new Error("No verified DreamDEX endpoint bundle is configured.");
  const start = ((input.startingIndex % input.bundles.length) + input.bundles.length) % input.bundles.length;
  let lastError: unknown;
  for (let offset = 0; offset < input.bundles.length; offset += 1) {
    const index = (start + offset) % input.bundles.length;
    try {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${input.bundles[index]!.label} timed out.`)),
          input.deadlineMs ?? ENDPOINT_ATTEMPT_DEADLINE_MS,
        );
      });
      const operation = Promise.resolve().then(() => input.attempt(input.bundles[index]!, index));
      return {
        value: await Promise.race([operation, timeout])
          .finally(() => { if (timeoutId !== undefined) clearTimeout(timeoutId); }),
        index,
        failedAttempts: offset,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Every verified DreamDEX endpoint bundle failed.");
}
