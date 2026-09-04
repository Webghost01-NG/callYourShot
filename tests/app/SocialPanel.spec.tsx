import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, WalletClient } from "viem";

const repositoryMocks = vi.hoisted(() => ({
  authenticatedWallet: vi.fn(),
  listProfiles: vi.fn(),
  signIn: vi.fn(),
  enroll: vi.fn(),
}));

vi.mock("../../src/social/repository.js", () => ({
  SupabaseSocialRepository: class {
    authenticatedWallet = repositoryMocks.authenticatedWallet;
    listProfiles = repositoryMocks.listProfiles;
    signIn = repositoryMocks.signIn;
    enroll = repositoryMocks.enroll;
    close() {}
  },
}));

import { SocialPanel } from "../../src/app/SocialPanel.js";

describe("social competition panel", () => {
  beforeEach(() => {
    repositoryMocks.authenticatedWallet.mockReset().mockResolvedValue(null);
    repositoryMocks.listProfiles.mockReset().mockResolvedValue([]);
    repositoryMocks.signIn.mockReset();
    repositoryMocks.enroll.mockReset().mockResolvedValue(undefined);
  });

  it("labels missing persistence configuration without inventing players", () => {
    render(
      <SocialPanel
        config={null}
        configError={null}
        connected={false}
        onConnect={async () => null}
      />,
    );
    expect(screen.getByText("Social league is not configured")).toBeTruthy();
    expect(screen.getByText(/No sample players are shown/)).toBeTruthy();
  });

  it("continues from wallet connection through sign-in and enrollment in one action", async () => {
    const address = `0x${"1".repeat(40)}` as Address;
    const walletClient = { account: { address } } as WalletClient;
    const onConnect = vi.fn().mockResolvedValue({ address, walletClient });
    repositoryMocks.signIn.mockResolvedValue(address);

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{} as never}
        connected={false}
        onConnect={onConnect}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Connect wallet" }));

    await waitFor(() => expect(repositoryMocks.enroll).toHaveBeenCalledWith(""));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.signIn).toHaveBeenCalledWith(walletClient, address);
    expect(await screen.findByText(/You joined/)).toBeTruthy();
  });
});
