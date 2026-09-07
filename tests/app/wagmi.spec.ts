import { describe, expect, it, vi } from "vitest";

const connector = vi.hoisted(() => ({ id: "injected" }));
vi.mock("wagmi/connectors", () => ({ injected: () => connector }));
vi.mock("wagmi", () => ({ createConfig: (config: unknown) => config, http: () => ({}) }));

import { wagmiConfig } from "../../src/app/wagmi.js";

describe("production wallet connectors", () => {
  it("keeps injected wallets without initializing the suspended QR connector", () => {
    expect(wagmiConfig.connectors).toEqual([connector]);
  });
});
