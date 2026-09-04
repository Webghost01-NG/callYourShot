import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MarketDiscoveryTimeoutError,
  withMarketDiscoveryDeadline,
} from "../../src/app/marketDiscovery.js";

describe("market discovery deadline", () => {
  afterEach(() => vi.useRealTimers());

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
