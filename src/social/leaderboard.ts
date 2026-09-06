import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import type { Rational } from "../core/profile.js";
import type { LeagueProfile, LeagueScoreSnapshot } from "./model.js";

export const MAX_BOARD_RECONCILIATIONS = 24;
export const SNAPSHOT_CANDIDATE_SLOTS = 18;
export const SNAPSHOT_STALE_AFTER_MS = 15 * 60_000;

export interface VerifiedLeagueProfile {
  enrollment: LeagueProfile;
  evidence: ReconciledProfile;
}

export interface LeagueBoard {
  ranked: VerifiedLeagueProfile[];
  provisional: VerifiedLeagueProfile[];
}

export interface BoardCandidate {
  enrollment: LeagueProfile;
  snapshot?: LeagueScoreSnapshot;
}

function compareRational(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference > 0n ? -1 : difference < 0n ? 1 : 0;
}

function stableTieBreak(left: VerifiedLeagueProfile, right: VerifiedLeagueProfile): number {
  if (left.evidence.profile.settledCount !== right.evidence.profile.settledCount) {
    return right.evidence.profile.settledCount - left.evidence.profile.settledCount;
  }
  const time = left.enrollment.enrolledAt.localeCompare(right.enrollment.enrolledAt);
  return time || left.enrollment.walletAddress.localeCompare(right.enrollment.walletAddress);
}

export function buildLeagueBoard(items: readonly VerifiedLeagueProfile[]): LeagueBoard {
  const complete = items.filter(({ evidence }) => !evidence.evidenceGaps.some((gap) =>
    gap.kind === "fill" || gap.kind === "market" || gap.kind === "settlement",
  ));
  const ranked = complete.filter(({ evidence }) =>
    evidence.profile.state === "verified" && evidence.profile.skillScore !== null,
  ).sort((left, right) => {
    const score = compareRational(left.evidence.profile.skillScore!, right.evidence.profile.skillScore!);
    return score || stableTieBreak(left, right);
  });
  const provisional = complete.filter(({ evidence }) => evidence.profile.state !== "verified")
    .sort(stableTieBreak);
  return { ranked, provisional };
}

function compareSnapshots(left: LeagueScoreSnapshot, right: LeagueScoreSnapshot): number {
  if (left.state !== right.state) {
    if (left.state === "verified") return -1;
    if (right.state === "verified") return 1;
  }
  if (left.scoreMicros !== right.scoreMicros) {
    return (right.scoreMicros ?? -1) - (left.scoreMicros ?? -1);
  }
  if (left.settledCount !== right.settledCount) return right.settledCount - left.settledCount;
  return left.walletAddress.localeCompare(right.walletAddress);
}

export function selectBoardCandidates(
  enrollments: readonly LeagueProfile[],
  snapshots: readonly LeagueScoreSnapshot[],
  preferredWallet?: string,
): BoardCandidate[] {
  const enrollmentByWallet = new Map(enrollments.map((item) => [item.walletAddress.toLowerCase(), item]));
  const orderedSnapshots = [...snapshots].sort(compareSnapshots);
  const selected = new Map<string, BoardCandidate>();
  for (const snapshot of orderedSnapshots.slice(0, SNAPSHOT_CANDIDATE_SLOTS)) {
    const enrollment = enrollmentByWallet.get(snapshot.walletAddress.toLowerCase());
    if (enrollment) selected.set(enrollment.walletAddress.toLowerCase(), { enrollment, snapshot });
  }

  const snapshotByWallet = new Map(snapshots.map((item) => [item.walletAddress.toLowerCase(), item]));
  for (const enrollment of [...enrollments].reverse()) {
    if (selected.size >= MAX_BOARD_RECONCILIATIONS) break;
    const key = enrollment.walletAddress.toLowerCase();
    if (!selected.has(key)) selected.set(key, { enrollment, snapshot: snapshotByWallet.get(key) });
  }

  if (preferredWallet) {
    const key = preferredWallet.toLowerCase();
    const preferred = enrollmentByWallet.get(key);
    if (preferred && !selected.has(key)) {
      const candidates = [...selected.keys()];
      const replaced = candidates[candidates.length - 1];
      if (replaced) selected.delete(replaced);
      selected.set(key, { enrollment: preferred, snapshot: snapshotByWallet.get(key) });
    }
  }
  return [...selected.values()];
}

export function scoreSnapshotFromEvidence(evidence: ReconciledProfile): Omit<
  LeagueScoreSnapshot,
  "profileId" | "walletAddress" | "capturedAt"
> {
  const score = evidence.profile.skillScore;
  const scoreMicros = score
    ? Number((2n * score.numerator * 1_000_000n + score.denominator) / (2n * score.denominator))
    : null;
  return {
    formulaVersion: evidence.profile.formulaVersion,
    state: evidence.profile.state,
    scoreNumerator: score?.numerator ?? null,
    scoreDenominator: score?.denominator ?? null,
    scoreMicros,
    settledCount: evidence.profile.settledCount,
    sourceBlock: evidence.sourceBlock,
  };
}

export function snapshotMatchesEvidence(
  snapshot: LeagueScoreSnapshot,
  evidence: ReconciledProfile,
): boolean {
  const current = scoreSnapshotFromEvidence(evidence);
  return snapshot.formulaVersion === current.formulaVersion
    && snapshot.state === current.state
    && snapshot.scoreNumerator === current.scoreNumerator
    && snapshot.scoreDenominator === current.scoreDenominator
    && snapshot.settledCount === current.settledCount
    && snapshot.sourceBlock === current.sourceBlock;
}

export function snapshotIsStale(snapshot: LeagueScoreSnapshot, nowMs = Date.now()): boolean {
  const captured = Date.parse(snapshot.capturedAt);
  return !Number.isFinite(captured) || nowMs - captured > SNAPSHOT_STALE_AFTER_MS;
}
