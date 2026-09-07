import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import type { Rational } from "../core/profile.js";
import type { LeagueProfile, LeagueScoreSnapshot } from "./model.js";

export const MAX_BOARD_RECONCILIATIONS = 24;
export const SNAPSHOT_STALE_AFTER_MS = 15 * 60_000;

export interface VerifiedLeagueProfile {
  enrollment: LeagueProfile;
  evidence: ReconciledProfile;
}

export interface LeagueBoard {
  ranked: VerifiedLeagueProfile[];
  provisional: VerifiedLeagueProfile[];
}

export interface BoardCandidateSelection {
  candidates: LeagueProfile[];
  cohortStart: number;
  nextCohortStart: number;
  cohortNumber: number;
  cohortCount: number;
  cycleComplete: boolean;
  totalEnrollments: number;
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

function compareEnrollments(left: LeagueProfile, right: LeagueProfile): number {
  const time = left.enrolledAt.localeCompare(right.enrolledAt);
  return time || left.walletAddress.toLowerCase().localeCompare(right.walletAddress.toLowerCase());
}

export function selectBoardCandidates(
  enrollments: readonly LeagueProfile[],
  requestedStart = 0,
): BoardCandidateSelection {
  const enrollmentByWallet = new Map<string, LeagueProfile>();
  for (const enrollment of enrollments) {
    const key = enrollment.walletAddress.toLowerCase();
    if (!enrollmentByWallet.has(key)) enrollmentByWallet.set(key, enrollment);
  }
  const orderedEnrollments = [...enrollmentByWallet.values()].sort(compareEnrollments);
  const totalEnrollments = orderedEnrollments.length;
  const cohortStart = Number.isSafeInteger(requestedStart)
    && requestedStart >= 0
    && requestedStart < totalEnrollments
    ? requestedStart
    : 0;
  const selectedEnrollments = orderedEnrollments.slice(
    cohortStart,
    cohortStart + MAX_BOARD_RECONCILIATIONS,
  );
  const end = cohortStart + selectedEnrollments.length;
  const cycleComplete = end >= totalEnrollments;
  return {
    candidates: selectedEnrollments,
    cohortStart,
    nextCohortStart: cycleComplete ? 0 : end,
    cohortNumber: totalEnrollments === 0
      ? 0
      : Math.floor(cohortStart / MAX_BOARD_RECONCILIATIONS) + 1,
    cohortCount: Math.ceil(totalEnrollments / MAX_BOARD_RECONCILIATIONS),
    cycleComplete,
    totalEnrollments,
  };
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
