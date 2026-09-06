import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import type { Address, Hex } from "viem";
import { rational, SCORE_FORMULA_VERSION, type SkillProfile } from "../src/core/profile.js";
import type { ReconciledProfile } from "../src/dreamdex/reconciliation.js";
import {
  buildLeagueBoard,
  MAX_BOARD_RECONCILIATIONS,
  scoreSnapshotFromEvidence,
  selectBoardCandidates,
  snapshotMatchesEvidence,
  type VerifiedLeagueProfile,
} from "../src/social/leaderboard.js";
import type { LeagueProfile, LeagueScoreSnapshot } from "../src/social/model.js";
import { normalizeDisplayName, verifiedWeb3Wallet } from "../src/social/repository.js";
import { challengeUrl, readSocialRoute, receiptUrl } from "../src/social/share.js";

const marketId = `0x${"a".repeat(64)}` as Hex;

function entry(options: {
  suffix: string;
  score: number;
  settled?: number;
  state?: SkillProfile["state"];
  profit?: bigint;
}): VerifiedLeagueProfile {
  const wallet = `0x${options.suffix.padStart(40, "0")}` as Address;
  const profile: SkillProfile = {
    account: wallet,
    formulaVersion: SCORE_FORMULA_VERSION,
    state: options.state ?? "verified",
    rounds: [],
    settledCount: options.settled ?? 10,
    wins: 0,
    accuracy: null,
    currentStreak: 0,
    bestStreak: 0,
    totalReturnRaw: options.profit ?? 0n,
    maximumDrawdownRaw: 0n,
    collateral: null,
    collateralDecimals: null,
    skillScore: rational(BigInt(options.score), 1n),
  };
  const enrollment: LeagueProfile = {
    id: options.suffix,
    walletAddress: wallet,
    displayName: null,
    enrolledAt: "2026-09-04T12:00:00.000Z",
    formulaVersion: SCORE_FORMULA_VERSION,
    updatedAt: "2026-09-04T12:00:00.000Z",
  };
  const evidence: ReconciledProfile = { profile, snapshotTimestampSec: 1n, sourceBlock: 100n, evidenceGaps: [] };
  return { enrollment, evidence };
}

test("leaderboard ranks verified skill and ignores dollar profit", () => {
  const richButLowerSkill = entry({ suffix: "1", score: 55, profit: 1_000_000n });
  const higherSkill = entry({ suffix: "2", score: 60, profit: -100n });
  const board = buildLeagueBoard([richButLowerSkill, higherSkill]);
  assert.equal(board.ranked[0]!.enrollment.walletAddress, higherSkill.enrollment.walletAddress);
});

test("provisional players never receive a leaderboard rank", () => {
  const provisional = entry({ suffix: "3", score: 90, settled: 9, state: "provisional" });
  const board = buildLeagueBoard([provisional]);
  assert.equal(board.ranked.length, 0);
  assert.equal(board.provisional[0], provisional);
});

test("qualification progress orders provisional players by verified sample size", () => {
  const oneCall = entry({ suffix: "5", score: 90, settled: 1, state: "provisional" });
  const nineCalls = entry({ suffix: "6", score: 20, settled: 9, state: "provisional" });
  const board = buildLeagueBoard([oneCall, nineCalls]);
  assert.deepEqual(board.ranked, []);
  assert.deepEqual(board.provisional, [nineCalls, oneCall]);
});

test("profiles with score-affecting evidence gaps are not published", () => {
  const incomplete = entry({ suffix: "4", score: 99 });
  incomplete.evidence.evidenceGaps.push({
    marketId,
    kind: "settlement",
    message: "Settlement unavailable",
  });
  const board = buildLeagueBoard([incomplete]);
  assert.equal(board.ranked.length, 0);
  assert.equal(board.provisional.length, 0);
});

test("leaderboard candidates are bounded while preserving the connected wallet", () => {
  const entries = Array.from({ length: 40 }, (_, index) => entry({
    suffix: (index + 1).toString(16),
    score: 50 + index,
  }));
  const snapshots: LeagueScoreSnapshot[] = entries.map(({ enrollment, evidence }, index) => ({
    profileId: enrollment.id,
    walletAddress: enrollment.walletAddress,
    capturedAt: "2026-09-06T12:00:00.000Z",
    ...scoreSnapshotFromEvidence(evidence),
    scoreMicros: index * 1_000_000,
  }));
  const preferred = entries[0]!.enrollment.walletAddress;
  const candidates = selectBoardCandidates(entries.map((item) => item.enrollment), snapshots, preferred);

  assert.equal(candidates.length, MAX_BOARD_RECONCILIATIONS);
  assert.equal(candidates.some((item) => item.enrollment.walletAddress === preferred), true);
});

test("cached score values must exactly match freshly rebuilt evidence", () => {
  const verified = entry({ suffix: "9", score: 63 });
  const snapshot: LeagueScoreSnapshot = {
    profileId: verified.enrollment.id,
    walletAddress: verified.enrollment.walletAddress,
    capturedAt: "2026-09-06T12:00:00.000Z",
    ...scoreSnapshotFromEvidence(verified.evidence),
  };
  assert.equal(snapshotMatchesEvidence(snapshot, verified.evidence), true);
  assert.equal(snapshotMatchesEvidence({ ...snapshot, settledCount: 11 }, verified.evidence), false);
});

test("display names are optional, constrained, and cannot impersonate the product", () => {
  assert.equal(normalizeDisplayName("  Alice-7  "), "Alice-7");
  assert.equal(normalizeDisplayName("   "), null);
  assert.throws(() => normalizeDisplayName("DreamDEX"), /reserved/);
  assert.throws(() => normalizeDisplayName("<script>"), /must be/);
});

test("reads the verified wallet from Supabase Web3 custom claims", () => {
  const wallet = "0x2981ad2090C329Cc5D9f0496de672d824959D196";
  const user = {
    identities: [{
      provider: "web3",
      identity_data: {
        custom_claims: {
          address: wallet,
          chain: "ethereum",
          network: "50312",
        },
      },
    }],
  } as unknown as Pick<User, "identities">;
  assert.equal(verifiedWeb3Wallet(user), wallet);
});

test("rejects wrong-network and obsolete flat Web3 identity claims", () => {
  const wallet = "0x2981ad2090C329Cc5D9f0496de672d824959D196";
  const wrongNetwork = {
    identities: [{
      provider: "web3",
      identity_data: {
        custom_claims: { address: wallet, chain: "ethereum", network: "1" },
      },
    }],
  } as unknown as Pick<User, "identities">;
  const flatClaims = {
    identities: [{
      provider: "web3",
      identity_data: { address: wallet, chain: "ethereum", network: "50312" },
    }],
  } as unknown as Pick<User, "identities">;
  assert.equal(verifiedWeb3Wallet(wrongNetwork), null);
  assert.equal(verifiedWeb3Wallet(flatClaims), null);
});

test("shared links contain only reconstructable evidence keys", () => {
  const wallet = "0x1111111111111111111111111111111111111111" as Address;
  const receipt = receiptUrl("https://call.example/?old=value#section", wallet, marketId);
  assert.deepEqual(readSocialRoute(new URL(receipt).search), { kind: "receipt", wallet, marketId });

  const id = "123e4567-e89b-42d3-a456-426614174000";
  const challenge = challengeUrl("https://call.example/", id);
  assert.deepEqual(readSocialRoute(new URL(challenge).search), { kind: "challenge", challengeId: id });
});
