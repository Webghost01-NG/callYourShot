import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, WalletClient } from "viem";

const repositoryMocks = vi.hoisted(() => ({
  authenticatedWallet: vi.fn(),
  listProfiles: vi.fn(),
  signIn: vi.fn(),
  enroll: vi.fn(),
  createChallenge: vi.fn(),
  getChallenge: vi.fn(),
}));

vi.mock("../../src/social/repository.js", () => ({
  SupabaseSocialRepository: class {
    authenticatedWallet = repositoryMocks.authenticatedWallet;
    listProfiles = repositoryMocks.listProfiles;
    signIn = repositoryMocks.signIn;
    enroll = repositoryMocks.enroll;
    createChallenge = repositoryMocks.createChallenge;
    getChallenge = repositoryMocks.getChallenge;
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
    repositoryMocks.createChallenge.mockReset();
    repositoryMocks.getChallenge.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
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

  it("explains why a challenge cannot be created without a live round", async () => {
    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{} as never}
        connected={true}
        onConnect={async () => null}
      />,
    );

    expect(await screen.findByText(/Waiting for an eligible live DreamDEX round/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "No live round to challenge" }));

    expect(await screen.findByText(/A challenge needs a live DreamDEX round/)).toBeTruthy();
    expect(repositoryMocks.createChallenge).not.toHaveBeenCalled();
  });

  it("keeps a created challenge link visible when clipboard access is unavailable", async () => {
    const address = `0x${"1".repeat(40)}` as Address;
    const invitee = `0x${"2".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}`;
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const enrolledAt = new Date().toISOString();
    repositoryMocks.authenticatedWallet.mockResolvedValue(address);
    repositoryMocks.listProfiles.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      walletAddress: address,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1",
      updatedAt: enrolledAt,
    }]);
    repositoryMocks.createChallenge.mockResolvedValue(challengeId);

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{
          loadPublicProfile: vi.fn().mockResolvedValue({
            evidenceGaps: [],
            profile: { state: "provisional", skillScore: null, settledCount: 0, rounds: [] },
          }),
        } as never}
        round={{ market: { marketId } } as never}
        connected={true}
        address={address}
        walletClient={{ account: { address } } as WalletClient}
        onConnect={async () => null}
      />,
    );

    expect(await screen.findByRole("button", { name: "Update name" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Friend’s wallet"), invitee);
    await userEvent.click(screen.getByRole("button", { name: "Copy challenge link" }));

    await waitFor(() => expect(repositoryMocks.createChallenge).toHaveBeenCalledWith(marketId, invitee));
    expect((await screen.findByLabelText("Shareable challenge link")).getAttribute("value"))
      .toContain(`challenge=${challengeId}`);
  });

  it("terminates a missing shared receipt instead of displaying an endless rebuild", async () => {
    const address = `0x${"1".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}`;
    const enrolledAt = new Date().toISOString();
    window.history.replaceState({}, "", `/?receiptWallet=${address}&receiptMarket=${marketId}`);
    repositoryMocks.listProfiles.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      walletAddress: address,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1",
      updatedAt: enrolledAt,
    }]);
    const loadPublicProfile = vi.fn().mockResolvedValue({
      evidenceGaps: [],
      profile: { state: "empty", skillScore: null, settledCount: 0, rounds: [] },
    });

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{ loadPublicProfile } as never}
        connected={false}
        onConnect={async () => null}
      />,
    );

    expect(await screen.findByText(/No verified result was found for this wallet and Event Contract/i)).toBeTruthy();
    expect(screen.queryByText(/Rebuilding this claim/i)).toBeNull();
  });

  it("terminates a failed shared receipt reconstruction with an error", async () => {
    const address = `0x${"1".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}`;
    const enrolledAt = new Date().toISOString();
    window.history.replaceState({}, "", `/?receiptWallet=${address}&receiptMarket=${marketId}`);
    repositoryMocks.listProfiles.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      walletAddress: address,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1",
      updatedAt: enrolledAt,
    }]);
    const loadPublicProfile = vi.fn().mockRejectedValue(new Error("DreamDEX evidence is temporarily unavailable."));

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{ loadPublicProfile } as never}
        connected={false}
        onConnect={async () => null}
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Result verification is unavailable|DreamDEX evidence is temporarily unavailable/i);
    expect(screen.queryByText(/Rebuilding this claim/i)).toBeNull();
  });

  it("terminates a missing challenge instead of displaying an endless rebuild", async () => {
    const challengeId = "11111111-1111-4111-8111-111111111111";
    window.history.replaceState({}, "", `/?challenge=${challengeId}`);
    repositoryMocks.getChallenge.mockResolvedValue(null);

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{} as never}
        connected={false}
        onConnect={async () => null}
      />,
    );

    expect(await screen.findByText(/This challenge was not found or is no longer available/i)).toBeTruthy();
    expect(screen.queryByText(/Rebuilding both records/i)).toBeNull();
  });

  it("keeps a result link visible when clipboard access is blocked", async () => {
    const address = `0x${"1".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}`;
    const enrolledAt = new Date().toISOString();
    repositoryMocks.authenticatedWallet.mockResolvedValue(address);
    repositoryMocks.listProfiles.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      walletAddress: address,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1",
      updatedAt: enrolledAt,
    }]);
    const settledRound = { marketId, state: "won" };
    const loadPublicProfile = vi.fn().mockResolvedValue({
      evidenceGaps: [],
      profile: {
        state: "provisional",
        skillScore: { numerator: 50n, denominator: 1n },
        settledCount: 1,
        rounds: [settledRound],
      },
    });
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("Clipboard denied"));

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{ loadPublicProfile } as never}
        connected={true}
        address={address}
        walletClient={{ account: { address } } as WalletClient}
        onConnect={async () => null}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Copy latest result" }));
    expect((await screen.findByLabelText("Shareable result link")).getAttribute("value"))
      .toContain(`receiptMarket=${marketId}`);
    expect(screen.getByText(/browser blocked automatic copying/i)).toBeTruthy();
  });
});
