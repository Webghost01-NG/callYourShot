import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import type { Rational } from "../core/profile.js";
import type { LeagueProfile } from "./model.js";

export interface VerifiedLeagueProfile {
  enrollment: LeagueProfile;
  evidence: ReconciledProfile;
}

export interface LeagueBoard {
  ranked: VerifiedLeagueProfile[];
  provisional: VerifiedLeagueProfile[];
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
