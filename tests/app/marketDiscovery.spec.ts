import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MARKET_DISCOVERY_DEADLINE_GRACE_MS,
  MarketDiscoveryTimeoutError,
  marketDiscoveryDeadlineMs,
  withMarketDiscoveryDeadline,
} from "../../src/app/marketDiscovery.js";
import { ENDPOINT_ATTEMPT_DEADLINE_MS } from "../../src/app/endpointFailover.js";

describe("market discovery deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("covers every bounded endpoint attempt plus UI scheduling grace", () => {
    expect(marketDiscoveryDeadlineMs(2)).toBe(
      (ENDPOINT_ATTEMPT_DEADLINE_MS * 2) + MARKET_DISCOVERY_DEADLINE_GRACE_MS,
    );
    expect(() => marketDiscoveryDeadlineMs(0)).toThrow(/at least one endpoint/i);
  });

  it("returns a result that arrives before the deadline", async () => {
    await expect(withMarketDiscoveryDeadline(Promise.resolve("ready"), 1_000))
      .resolves.toBe("ready");
  });

  it("rejects a request that remains pending", async () => {
    vi.useFakeTimers();
    const result = withMarketDiscoveryDeadline(new Promise<never>(() => undefined), 1_000);
    const rejection = expect(result).rejects.toBeInstanceOf(MarketDiscoveryTimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });
});
