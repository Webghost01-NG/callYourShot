import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, WalletClient } from "viem";

const repositoryMocks = vi.hoisted(() => ({
  authenticatedWallet: vi.fn(),
  listProfiles: vi.fn(),
  listScoreSnapshots: vi.fn(),
  publishScoreSnapshot: vi.fn(),
  signIn: vi.fn(),
  enroll: vi.fn(),
  createChallenge: vi.fn(),
  getChallenge: vi.fn(),
  acceptChallenge: vi.fn(),
}));

vi.mock("../../src/social/repository.js", () => ({
  SupabaseSocialRepository: class {
    authenticatedWallet = repositoryMocks.authenticatedWallet;
    listProfiles = repositoryMocks.listProfiles;
    listScoreSnapshots = repositoryMocks.listScoreSnapshots;
    publishScoreSnapshot = repositoryMocks.publishScoreSnapshot;
    signIn = repositoryMocks.signIn;
    enroll = repositoryMocks.enroll;
    createChallenge = repositoryMocks.createChallenge;
    getChallenge = repositoryMocks.getChallenge;
    acceptChallenge = repositoryMocks.acceptChallenge;
    close() {}
  },
}));

import { SocialPanel } from "../../src/app/SocialPanel.js";

describe("social competition panel", () => {
  beforeEach(() => {
    repositoryMocks.authenticatedWallet.mockReset().mockResolvedValue(null);
    repositoryMocks.listProfiles.mockReset().mockResolvedValue([]);
    repositoryMocks.listScoreSnapshots.mockReset().mockResolvedValue([]);
    repositoryMocks.publishScoreSnapshot.mockReset().mockResolvedValue("snapshot-profile");
    repositoryMocks.signIn.mockReset();
    repositoryMocks.enroll.mockReset().mockResolvedValue(undefined);
    repositoryMocks.createChallenge.mockReset();
    repositoryMocks.getChallenge.mockReset();
    repositoryMocks.acceptChallenge.mockReset();
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

  it("uses deterministic cohorts and discloses complete leaderboard coverage", async () => {
    const enrolledAt = "2026-09-06T12:00:00.000Z";
    repositoryMocks.listProfiles.mockResolvedValue(Array.from({ length: 30 }, (_, index) => ({
      id: `profile-${index}`,
      walletAddress: `0x${(index + 1).toString(16).padStart(40, "0")}` as Address,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1" as const,
      updatedAt: enrolledAt,
    })));
    // Flood the old 18 snapshot slots with inflated claims for later wallets.
    repositoryMocks.listScoreSnapshots.mockResolvedValue(Array.from({ length: 18 }, (_, index) => ({
      profileId: `profile-${index + 12}`,
      walletAddress: `0x${(index + 13).toString(16).padStart(40, "0")}`,
      formulaVersion: "CYS-EDGE-v1",
      state: "verified",
      scoreNumerator: 100n,
      scoreDenominator: 1n,
      scoreMicros: 100_000_000,
      settledCount: 999,
      sourceBlock: 100n,
      capturedAt: enrolledAt,
    })));
    const loadPublicProfile = vi.fn().mockResolvedValue({
      snapshotTimestampSec: 1_000n,
      sourceBlock: 100n,
      evidenceGaps: [],
      profile: { state: "empty", skillScore: null, settledCount: 0, rounds: [] },
    });

    render(<SocialPanel
      config={{
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_example",
      }}
      configError={null}
      runtime={{ loadPublicProfile } as never}
      connected={false}
      onConnect={async () => null}
    />);

    expect(await screen.findByText(/24 of 30 enrolled wallets checked/i)).toBeTruthy();
    expect(screen.getByText(/hard limit 24 per refresh/i)).toBeTruthy();
    expect(screen.getByText(/cohort 1 of 2/i)).toBeTruthy();
    expect(screen.getByText(/published score claims never choose membership/i)).toBeTruthy();
    expect(loadPublicProfile).toHaveBeenCalledTimes(24);
    expect(loadPublicProfile.mock.calls.map(([wallet]) => wallet)).toEqual(
      Array.from({ length: 24 }, (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`),
    );

    await userEvent.click(screen.getByRole("button", { name: "Verify next cohort" }));

    expect(await screen.findByText(/30 of 30 enrolled wallets checked/i)).toBeTruthy();
    expect(screen.getByText("Whole-league verified leaderboard")).toBeTruthy();
    expect(loadPublicProfile).toHaveBeenCalledTimes(30);
    expect(new Set(loadPublicProfile.mock.calls.map(([wallet]) => wallet)).size).toBe(30);
  });

  it("keeps the board a subset when any enrolled wallet cannot be verified", async () => {
    const enrolledAt = "2026-09-06T12:00:00.000Z";
    repositoryMocks.listProfiles.mockResolvedValue([{
      id: "failed-profile",
      walletAddress: `0x${"1".repeat(40)}`,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1",
      updatedAt: enrolledAt,
    }]);
    const loadPublicProfile = vi.fn().mockRejectedValue(new Error("RPC unavailable"));
    render(<SocialPanel
      config={{ supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "sb_publishable_example" }}
      configError={null}
      runtime={{ loadPublicProfile } as never}
      connected={false}
      onConnect={async () => null}
    />);
    expect(await screen.findByText(/1 profile was excluded/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Verified subset" })).toBeTruthy();
    expect(screen.queryByText("Whole-league verified leaderboard")).toBeNull();
  });

  it("rebuilds a settled receipt directly from DreamDEX without Supabase or live liquidity", async () => {
    const address = `0x${"1".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}` as Hex;
    const fillHash = `0x${"4".repeat(64)}` as Hex;
    const finalizationHash = `0x${"5".repeat(64)}` as Hex;
    const loadPublicProfile = vi.fn().mockResolvedValue({
      evidenceGaps: [],
      profile: {
        state: "provisional",
        skillScore: { numerator: 236n, denominator: 5n },
        settledCount: 1,
        rounds: [{
          marketId,
          question: "Does this event settle YES?",
          side: "UP",
          fillTransactionHash: fillHash,
          settlementTransactionHash: finalizationHash,
          oracleTransactionHash: null,
          timestampSec: 1n,
          quantity: 1_000_000n,
          weightedPriceNumerator: 56_000_000_000n,
          confidence: { numerator: 7n, denominator: 125n },
          state: "lost",
          roundPoints: { numerator: -28n, denominator: 5n },
          entryCostRaw: 56_000n,
          payoutRaw: 0n,
          returnRaw: -56_000n,
        }],
      },
    });

    render(
      <SocialPanel
        config={null}
        configError="Social persistence is unavailable."
        runtime={{ loadPublicProfile } as never}
        route={{ kind: "receipt", wallet: address, marketId }}
        rounds={[]}
        marketDiscoveryState="empty"
        connected={false}
        onConnect={async () => null}
      />,
    );

    expect(await screen.findByText("5.60%")).toBeTruthy();
    expect(screen.getByText("-5.60")).toBeTruthy();
    expect(screen.getByText("47.20")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Verify fill/i }).getAttribute("href")).toContain(fillHash);
    expect(screen.getByRole("link", { name: /Verify finalization/i }).getAttribute("href")).toContain(finalizationHash);
    expect(screen.getByText(/does not depend on Supabase/i)).toBeTruthy();
    expect(loadPublicProfile).toHaveBeenCalledWith(address);
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

  it("focuses a direct challenge and selects its exact live Event Contract", async () => {
    const creator = `0x${"1".repeat(40)}` as Address;
    const invitee = `0x${"2".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}`;
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const enrolledAt = new Date().toISOString();
    repositoryMocks.listProfiles.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      walletAddress: creator,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1",
      updatedAt: enrolledAt,
    }]);
    repositoryMocks.getChallenge.mockResolvedValue({
      id: challengeId,
      creatorWallet: creator,
      invitedWallet: invitee,
      opponentWallet: null,
      marketId,
      status: "open",
      createdAt: enrolledAt,
      acceptedAt: null,
      cancelledAt: null,
    });
    const onSelectMarket = vi.fn();

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
            profile: { state: "empty", skillScore: null, settledCount: 0, rounds: [] },
          }),
        } as never}
        route={{ kind: "challenge", challengeId }}
        rounds={[{
          market: {
            marketId,
            expirySec: BigInt(Math.floor(Date.now() / 1_000) + 900),
          },
          book: { yesAsks: [{ price: 500_000n }], noAsks: [] },
        } as never]}
        marketDiscoveryState="ready"
        connected={false}
        onConnect={async () => null}
        onSelectMarket={onSelectMarket}
      />,
    );

    expect(await screen.findByText("Direct friend challenge")).toBeTruthy();
    expect(await screen.findByText(/Exact Event Contract found and selected/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Go to the matching market/i }).getAttribute("href")).toBe("#arena");
    await waitFor(() => expect(onSelectMarket).toHaveBeenCalledWith(marketId));
  });

  it("does not substitute another market when a shared challenge is unavailable", async () => {
    const creator = `0x${"1".repeat(40)}` as Address;
    const invitee = `0x${"2".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}`;
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const enrolledAt = new Date().toISOString();
    repositoryMocks.listProfiles.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222",
      walletAddress: creator,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1",
      updatedAt: enrolledAt,
    }]);
    repositoryMocks.getChallenge.mockResolvedValue({
      id: challengeId,
      creatorWallet: creator,
      invitedWallet: invitee,
      opponentWallet: null,
      marketId,
      status: "open",
      createdAt: enrolledAt,
      acceptedAt: null,
      cancelledAt: null,
    });
    const onSelectMarket = vi.fn();

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
            profile: { state: "empty", skillScore: null, settledCount: 0, rounds: [] },
          }),
        } as never}
        route={{ kind: "challenge", challengeId }}
        rounds={[]}
        marketDiscoveryState="ready"
        connected={false}
        onConnect={async () => null}
        onSelectMarket={onSelectMarket}
      />,
    );

    expect(await screen.findByText(/no replacement market will be selected/i)).toBeTruthy();
    expect(screen.getByText(/Challenge expired/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept with verified wallet/i })).toBeNull();
    expect(onSelectMarket).not.toHaveBeenCalled();
  });

  it("turns a completed comparison into a prefilled live-event rematch", async () => {
    const creator = `0x${"1".repeat(40)}` as Address;
    const invitee = `0x${"2".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}` as Hex;
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const enrolledAt = "2026-09-04T12:00:00.000Z";
    repositoryMocks.listProfiles.mockResolvedValue([creator, invitee].map((walletAddress, index) => ({
      id: `${index + 2}2222222-2222-4222-8222-222222222222`,
      walletAddress,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1" as const,
      updatedAt: enrolledAt,
    })));
    repositoryMocks.getChallenge.mockResolvedValue({
      id: challengeId,
      creatorWallet: creator,
      invitedWallet: invitee,
      opponentWallet: invitee,
      marketId,
      status: "accepted",
      createdAt: enrolledAt,
      acceptedAt: enrolledAt,
      cancelledAt: null,
    });
    const loadPublicProfile = vi.fn().mockImplementation(async (wallet: Address) => ({
      evidenceGaps: [],
      profile: {
        state: "provisional",
        skillScore: { numerator: 50n, denominator: 1n },
        settledCount: 1,
        rounds: [{
          marketId,
          question: "Will this event settle YES?",
          side: wallet.toLowerCase() === creator.toLowerCase() ? "UP" : "DOWN",
          state: "won",
          roundPoints: { numerator: 10n, denominator: 1n },
          fillTransactionHash: `0x${"4".repeat(64)}`,
          settlementTransactionHash: `0x${"5".repeat(64)}`,
        }],
      },
    }));

    render(<SocialPanel
      config={{
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_example",
      }}
      configError={null}
      runtime={{ loadPublicProfile } as never}
      route={{ kind: "challenge", challengeId }}
      rounds={[]}
      marketDiscoveryState="ready"
      connected={true}
      address={invitee}
      walletClient={{ account: { address: invitee } } as WalletClient}
      onConnect={async () => null}
    />);

    expect(await screen.findByText(/Completed · both calls earned the same score/i)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Verify fill/i })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Verify result/i })).toHaveLength(2);
    const rematch = screen.getByRole("link", { name: /Challenge again on a live event/i });
    expect(rematch.getAttribute("href")).toContain(`inviteWallet=${creator}`);
    expect(rematch.getAttribute("href")).toContain("#league-identity");
  });

  it("prefills the previous opponent without selecting a fake rematch market", async () => {
    const opponent = `0x${"1".repeat(40)}` as Address;
    window.history.replaceState({}, "", `/?inviteWallet=${opponent}#league-identity`);

    render(<SocialPanel
      config={{
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_example",
      }}
      configError={null}
      runtime={{} as never}
      round={undefined}
      connected={false}
      onConnect={async () => null}
    />);

    expect((await screen.findByLabelText("Friend’s wallet")).getAttribute("value")).toBe(opponent);
    expect(screen.getByText(/Previous opponent ready/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "No live round to challenge" })).toBeTruthy();
  });

  it("revalidates the exact Event Contract before accepting a challenge", async () => {
    const creator = `0x${"1".repeat(40)}` as Address;
    const invitee = `0x${"2".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}`;
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const enrolledAt = new Date().toISOString();
    repositoryMocks.authenticatedWallet.mockResolvedValue(invitee);
    repositoryMocks.listProfiles.mockResolvedValue([creator, invitee].map((walletAddress, index) => ({
      id: `${index + 2}2222222-2222-4222-8222-222222222222`,
      walletAddress,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1" as const,
      updatedAt: enrolledAt,
    })));
    repositoryMocks.getChallenge.mockResolvedValue({
      id: challengeId,
      creatorWallet: creator,
      invitedWallet: invitee,
      opponentWallet: null,
      marketId,
      status: "open",
      createdAt: enrolledAt,
      acceptedAt: null,
      cancelledAt: null,
    });
    const refreshRound = vi.fn().mockRejectedValue(new Error("The selected Event Contract is no longer tradable"));
    const liveRound = {
      market: {
        marketId,
        expirySec: BigInt(Math.floor(Date.now() / 1_000) + 900),
      },
      book: { yesAsks: [{ price: 500_000n }], noAsks: [] },
    };

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{
          refreshRound,
          loadPublicProfile: vi.fn().mockResolvedValue({
            evidenceGaps: [],
            profile: { state: "empty", skillScore: null, settledCount: 0, rounds: [] },
          }),
        } as never}
        route={{ kind: "challenge", challengeId }}
        rounds={[liveRound as never]}
        marketDiscoveryState="ready"
        connected={true}
        address={invitee}
        walletClient={{ account: { address: invitee } } as WalletClient}
        onConnect={async () => null}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Accept with verified wallet" }));

    expect(refreshRound).toHaveBeenCalledWith(marketId);
    expect(repositoryMocks.acceptChallenge).not.toHaveBeenCalled();
    expect(await screen.findByText(/no longer tradable/i)).toBeTruthy();
  });

  it("lets the invited wallet re-check and accept when the lobby snapshot omits the exact market", async () => {
    const creator = `0x${"1".repeat(40)}` as Address;
    const invitee = `0x${"2".repeat(40)}` as Address;
    const marketId = `0x${"3".repeat(64)}` as Hex;
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const enrolledAt = new Date().toISOString();
    repositoryMocks.authenticatedWallet.mockResolvedValue(invitee);
    repositoryMocks.listProfiles.mockResolvedValue([creator, invitee].map((walletAddress, index) => ({
      id: `${index + 2}2222222-2222-4222-8222-222222222222`,
      walletAddress,
      displayName: null,
      enrolledAt,
      formulaVersion: "CYS-EDGE-v1" as const,
      updatedAt: enrolledAt,
    })));
    const challenge = {
      id: challengeId,
      creatorWallet: creator,
      invitedWallet: invitee,
      opponentWallet: null,
      marketId,
      status: "open" as const,
      createdAt: enrolledAt,
      acceptedAt: null,
      cancelledAt: null,
    };
    repositoryMocks.getChallenge.mockResolvedValue(challenge);
    repositoryMocks.acceptChallenge.mockResolvedValue(challengeId);
    const exactRound = {
      market: {
        marketId,
        expirySec: BigInt(Math.floor(Date.now() / 1_000) + 900),
      },
      book: { yesAsks: [{ price: 500_000n }], noAsks: [] },
    };
    const refreshRound = vi.fn().mockResolvedValue(exactRound);

    render(
      <SocialPanel
        config={{
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_example",
        }}
        configError={null}
        runtime={{
          refreshRound,
          loadPublicProfile: vi.fn().mockResolvedValue({
            evidenceGaps: [],
            profile: { state: "empty", skillScore: null, settledCount: 0, rounds: [] },
          }),
        } as never}
        route={{ kind: "challenge", challengeId }}
        rounds={[]}
        marketDiscoveryState="ready"
        connected={true}
        address={invitee}
        walletClient={{ account: { address: invitee } } as WalletClient}
        onConnect={async () => null}
      />,
    );

    expect(await screen.findByText(/not in the current lobby snapshot/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Re-check exact market and accept" }));

    expect(refreshRound).toHaveBeenCalledWith(marketId);
    expect(repositoryMocks.acceptChallenge).toHaveBeenCalledWith(challengeId);
    expect(await screen.findByText(/Challenge accepted/i)).toBeTruthy();
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

    expect(await screen.findByText(/Qualification is underway/i)).toBeTruthy();
    expect(screen.getByText(/1 caller is building a verified record/i)).toBeTruthy();
    expect(screen.getByText(/provisional score 50.00/i)).toBeTruthy();
    expect(screen.getByText("1/10")).toBeTruthy();
    expect(screen.getByText("not ranked")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Copy latest result" }));
    expect((await screen.findByLabelText("Shareable result link")).getAttribute("value"))
      .toContain(`receiptMarket=${marketId}`);
    expect(screen.getByText(/browser blocked automatic copying/i)).toBeTruthy();
  });
});
