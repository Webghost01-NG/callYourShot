import { describe, expect, it } from "vitest";
import { readPublicConfig } from "../../src/app/config.js";
import { readSocialConfig } from "../../src/social/config.js";

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

describe("public social configuration", () => {
  it("keeps the social layer explicitly disabled when both values are absent", () => {
    expect(readSocialConfig(env({}))).toBeNull();
  });

  it("requires both public values", () => {
    expect(() => readSocialConfig(env({ VITE_SUPABASE_URL: "https://example.supabase.co" })))
      .toThrow(/Both public/);
  });

  it("accepts a publishable key and rejects a secret key", () => {
    expect(readSocialConfig(env({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    }))).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "sb_publishable_example",
    });
    expect(() => readSocialConfig(env({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_example",
    }))).toThrow(/must never be exposed/);
  });

  it("rejects a legacy service-role JWT", () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    expect(() => readSocialConfig(env({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: `header.${payload}.signature`,
    }))).toThrow(/must never be exposed/);
  });
});
