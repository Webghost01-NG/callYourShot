import { ENDPOINT_ATTEMPT_DEADLINE_MS } from "./endpointFailover.js";

export const MARKET_DISCOVERY_DEADLINE_GRACE_MS = 5_000;
export const MARKET_DISCOVERY_ENDPOINT_COUNT = 2;

export function marketDiscoveryDeadlineMs(endpointCount: number): number {
  if (!Number.isSafeInteger(endpointCount) || endpointCount < 1) {
    throw new Error("Market discovery requires at least one endpoint bundle.");
  }
  return (ENDPOINT_ATTEMPT_DEADLINE_MS * endpointCount) + MARKET_DISCOVERY_DEADLINE_GRACE_MS;
}

export const MARKET_DISCOVERY_DEADLINE_MS = marketDiscoveryDeadlineMs(
  MARKET_DISCOVERY_ENDPOINT_COUNT,
);

export class MarketDiscoveryTimeoutError extends Error {
  constructor() {
    super("DreamDEX market discovery timed out. Check your connection and try again.");
    this.name = "MarketDiscoveryTimeoutError";
  }
}

export async function withMarketDiscoveryDeadline<T>(
  operation: Promise<T>,
  deadlineMs = MARKET_DISCOVERY_DEADLINE_MS,
): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new MarketDiscoveryTimeoutError()), deadlineMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}
