import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileRound } from "../src/core/profile.js";
import {
  completedChallengeResult,
  deriveChallengeLifecycle,
} from "../src/social/challenge.js";

function round(state: ProfileRound["state"], points: number | null): ProfileRound {
  return {
    state,
    roundPoints: points === null ? null : { numerator: BigInt(points), denominator: 1n },
  } as ProfileRound;
}

test("expires an unaccepted challenge when its exact market is unavailable", () => {
  assert.equal(deriveChallengeLifecycle({
    status: "open",
    creator: null,
    opponent: null,
    market: "unavailable",
  }), "expired");
});

test("keeps two real calls pending until DreamDEX settlement", () => {
  assert.equal(deriveChallengeLifecycle({
    status: "accepted",
    creator: round("pending", null),
    opponent: round("pending", null),
    market: "unavailable",
  }), "awaiting-settlement");
});

test("does not complete an invitation that was never accepted", () => {
  assert.equal(deriveChallengeLifecycle({
    status: "open",
    creator: round("won", 25),
    opponent: round("won", 40),
    market: "live",
  }), "open");
});

test("completes a challenge from settled evidence and compares exact round points", () => {
  const creator = round("won", 25);
  const opponent = round("won", 40);
  assert.equal(deriveChallengeLifecycle({
    status: "accepted",
    creator,
    opponent,
    market: "unavailable",
  }), "completed");
  assert.equal(completedChallengeResult(creator, opponent), "opponent");
});
