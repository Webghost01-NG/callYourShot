import { describe, expect, it } from "vitest";
import { readPublicConfig } from "../../src/app/config.js";

function env(values: Record<string, string>) {
  return values as unknown as ImportMetaEnv;
}

describe("public configuration", () => {
  it("requires an explicit trusted venue origin", () => {
    expect(() => readPublicConfig(env({}))).toThrow(/required/);
  });

  it("accepts a valid public origin without market or pool IDs", () => {
    const config = readPublicConfig(env({
      VITE_DREAMDEX_OPERATOR_ID: "2",
      VITE_DREAMDEX_VENUE_ID: `0x${"a".repeat(64)}`,
    }));
    expect(config.operatorId).toBe(2);
    expect(config.venueId).toHaveLength(66);
  });
});
