import { describe, expect, it } from "vitest";
import { readWalletConnectionEnvironment } from "../../src/app/walletEnvironment.js";

describe("wallet connection environment", () => {
  it("keeps WalletConnect disabled when no public project ID is configured", () => {
    expect(readWalletConnectionEnvironment({})).toEqual({});
    expect(readWalletConnectionEnvironment({ VITE_REOWN_PROJECT_ID: "  " })).toEqual({});
  });

  it("accepts a browser-safe public project ID", () => {
    expect(readWalletConnectionEnvironment({
      VITE_REOWN_PROJECT_ID: "0123456789abcdef0123456789abcdef",
    })).toEqual({
      reownProjectId: "0123456789abcdef0123456789abcdef",
    });
  });

  it("fails closed for malformed project IDs", () => {
    expect(readWalletConnectionEnvironment({
      VITE_REOWN_PROJECT_ID: "https://example.test/not-a-project-id",
    })).toEqual({
      error: "Mobile wallet connection is disabled because VITE_REOWN_PROJECT_ID is invalid.",
    });
  });
});
