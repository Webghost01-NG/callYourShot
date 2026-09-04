import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { rational, SCORE_FORMULA_VERSION, type SkillProfile } from "../src/core/profile.js";
import type { ReconciledProfile } from "../src/dreamdex/reconciliation.js";
import { buildLeagueBoard, type VerifiedLeagueProfile } from "../src/social/leaderboard.js";
import type { LeagueProfile } from "../src/social/model.js";
import { normalizeDisplayName } from "../src/social/repository.js";
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
  const evidence: ReconciledProfile = { profile, snapshotTimestampSec: 1n, evidenceGaps: [] };
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

test("display names are optional, constrained, and cannot impersonate the product", () => {
  assert.equal(normalizeDisplayName("  Alice-7  "), "Alice-7");
  assert.equal(normalizeDisplayName("   "), null);
  assert.throws(() => normalizeDisplayName("DreamDEX"), /reserved/);
  assert.throws(() => normalizeDisplayName("<script>"), /must be/);
});

test("shared links contain only reconstructable evidence keys", () => {
  const wallet = "0x1111111111111111111111111111111111111111" as Address;
  const receipt = receiptUrl("https://call.example/?old=value#section", wallet, marketId);
  assert.deepEqual(readSocialRoute(new URL(receipt).search), { kind: "receipt", wallet, marketId });

  const id = "123e4567-e89b-42d3-a456-426614174000";
  const challenge = challengeUrl("https://call.example/", id);
  assert.deepEqual(readSocialRoute(new URL(challenge).search), { kind: "challenge", challengeId: id });
});
