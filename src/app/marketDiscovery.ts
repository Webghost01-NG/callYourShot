export const MARKET_DISCOVERY_DEADLINE_MS = 20_000;

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
