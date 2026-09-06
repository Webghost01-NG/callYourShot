import type { ProfileRound, Rational } from "../core/profile.js";
import type { ChallengeStatus } from "./model.js";

export type ChallengeMarketState = "checking" | "live" | "unavailable";
export type ChallengeLifecycle =
  | "open"
  | "accepted"
  | "cancelled"
  | "expired"
  | "locked-incomplete"
  | "awaiting-settlement"
  | "completed";

function isSettled(round: ProfileRound): boolean {
  return round.state !== "pending";
}

export function deriveChallengeLifecycle(input: {
  status: ChallengeStatus;
  creator: ProfileRound | null;
  opponent: ProfileRound | null;
  market: ChallengeMarketState;
}): ChallengeLifecycle {
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "accepted" && input.creator && input.opponent) {
    return isSettled(input.creator) && isSettled(input.opponent)
      ? "completed"
      : "awaiting-settlement";
  }
  if (input.market === "unavailable") {
    return input.status === "open" ? "expired" : "locked-incomplete";
  }
  return input.status;
}

function compareRational(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function completedChallengeResult(
  creator: ProfileRound,
  opponent: ProfileRound,
): "creator" | "opponent" | "draw" | "unscored" {
  if (!creator.roundPoints || !opponent.roundPoints) return "unscored";
  const comparison = compareRational(creator.roundPoints, opponent.roundPoints);
  return comparison > 0 ? "creator" : comparison < 0 ? "opponent" : "draw";
}
