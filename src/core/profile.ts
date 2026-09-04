import type { Address, Hex } from "viem";
import { CoreValidationError } from "./errors.js";

export const SCORE_FORMULA_VERSION = "CYS-EDGE-v1" as const;

export interface ProfileFill {
  id: string;
  marketId: Hex;
  transactionHash: Hex;
  timestampSec: bigint;
  blockNumber: bigint;
  logIndex: number;
  orderId: bigint;
  side: "BUY_YES" | "BUY_NO";
  yesPrice: bigint;
  quantity: bigint;
}

export interface MarketEvidence {
  marketId: Hex;
  question: string;
  collateral: Address;
  decimals: number;
  quantityDecimals: number;
  finalized: boolean;
  voided: boolean;
  winningOutcome: 0 | 1 | null;
  payoutNumerators: readonly bigint[] | null;
  payoutDenominator: bigint | null;
  settlementTransactionHash: Hex | null;
  oracleTransactionHash: Hex | null;
}

export interface Rational {
  numerator: bigint;
  denominator: bigint;
}

export interface ProfileRound {
  marketId: Hex;
  question: string;
  side: "UP" | "DOWN";
  fillTransactionHash: Hex;
  settlementTransactionHash: Hex | null;
  oracleTransactionHash: Hex | null;
  timestampSec: bigint;
  quantity: bigint;
  weightedPriceNumerator: bigint;
  confidence: Rational;
  state: "pending" | "void" | "won" | "lost";
  roundPoints: Rational | null;
  entryCostRaw: bigint;
  payoutRaw: bigint | null;
  returnRaw: bigint | null;
}

export interface SkillProfile {
  account: Address;
  formulaVersion: typeof SCORE_FORMULA_VERSION;
  state: "empty" | "provisional" | "verified";
  rounds: ProfileRound[];
  settledCount: number;
  wins: number;
  accuracy: Rational | null;
  currentStreak: number;
  bestStreak: number;
  totalReturnRaw: bigint;
  maximumDrawdownRaw: bigint;
  collateral: Address | null;
  collateralDecimals: number | null;
  skillScore: Rational | null;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator <= 0n) throw new CoreValidationError("rational denominator must be positive");
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function formatRational(value: Rational, places = 2): string {
  const displayScale = 10n ** BigInt(places);
  const negative = value.numerator < 0n;
  const absolute = negative ? -value.numerator : value.numerator;
  const rounded = (2n * absolute * displayScale + value.denominator)
    / (2n * value.denominator);
  const whole = rounded / displayScale;
  const fraction = (rounded % displayScale).toString().padStart(places, "0");
  return `${negative ? "-" : ""}${whole}${places > 0 ? `.${fraction}` : ""}`;
}

export function reconcileProfile(input: {
  account: Address;
  fills: readonly ProfileFill[];
  markets: ReadonlyMap<string, MarketEvidence>;
}): SkillProfile {
  const uniqueFills = new Map(input.fills.map((fill) => [fill.id, fill]));
  const ordered = [...uniqueFills.values()].sort((left, right) =>
    left.blockNumber === right.blockNumber
      ? left.logIndex - right.logIndex
      : left.blockNumber < right.blockNumber ? -1 : 1,
  );
  const firstOrderByMarket = new Map<string, bigint>();
  for (const fill of ordered) {
    const key = fill.marketId.toLowerCase();
    if (!firstOrderByMarket.has(key)) firstOrderByMarket.set(key, fill.orderId);
  }

  const grouped = new Map<string, ProfileFill[]>();
  for (const fill of ordered) {
    const key = fill.marketId.toLowerCase();
    if (fill.orderId !== firstOrderByMarket.get(key)) continue;
    const group = grouped.get(key) ?? [];
    group.push(fill);
    grouped.set(key, group);
  }

  let collateral: Address | null = null;
  let collateralDecimals: number | null = null;
  const rounds: ProfileRound[] = [];
  for (const [key, fills] of grouped) {
    const market = input.markets.get(key);
    if (!market) continue;
    if (collateral && collateral.toLowerCase() !== market.collateral.toLowerCase()) {
      throw new CoreValidationError("profile spans incompatible collateral tokens");
    }
    if (collateralDecimals !== null && collateralDecimals !== market.decimals) {
      throw new CoreValidationError("profile spans incompatible collateral scales");
    }
    collateral = market.collateral;
    collateralDecimals = market.decimals;
    const side: ProfileRound["side"] = fills[0]!.side === "BUY_YES" ? "UP" : "DOWN";
    if (fills.some((fill) => fill.side !== fills[0]!.side)) {
      throw new CoreValidationError("one locked order contains conflicting sides");
    }
    if (!Number.isSafeInteger(market.decimals) || market.decimals < 0) {
      throw new CoreValidationError("collateral decimals are invalid");
    }
    if (!Number.isSafeInteger(market.quantityDecimals) || market.quantityDecimals < 0) {
      throw new CoreValidationError("outcome decimals are invalid");
    }
    const scale = 10n ** BigInt(market.decimals);
    const quantityScale = 10n ** BigInt(market.quantityDecimals);
    const quantity = fills.reduce((sum, fill) => sum + fill.quantity, 0n);
    const weightedPriceNumerator = fills.reduce((sum, fill) => {
      const selectedPrice = side === "UP" ? fill.yesPrice : scale - fill.yesPrice;
      if (selectedPrice <= 0n || selectedPrice >= scale) {
        throw new CoreValidationError("fill price is outside the outcome range");
      }
      return sum + selectedPrice * fill.quantity;
    }, 0n);
    const entryCostRaw = fills.reduce((sum, fill) => {
      const selectedPrice = side === "UP" ? fill.yesPrice : scale - fill.yesPrice;
      return sum + selectedPrice * fill.quantity / quantityScale;
    }, 0n);
    const base = {
      marketId: market.marketId,
      question: market.question,
      side,
      fillTransactionHash: fills[0]!.transactionHash,
      settlementTransactionHash: market.settlementTransactionHash,
      oracleTransactionHash: market.oracleTransactionHash,
      timestampSec: fills[0]!.timestampSec,
      quantity,
      weightedPriceNumerator,
      confidence: rational(weightedPriceNumerator, scale * quantity),
      entryCostRaw,
    };
    if (!market.finalized) {
      rounds.push({ ...base, state: "pending", roundPoints: null, payoutRaw: null, returnRaw: null });
      continue;
    }
    if (market.voided) {
      rounds.push({ ...base, state: "void", roundPoints: null, payoutRaw: null, returnRaw: null });
      continue;
    }
    if (market.winningOutcome !== 0 && market.winningOutcome !== 1) {
      throw new CoreValidationError("finalized market has no verified winner");
    }
    if (!market.payoutNumerators || market.payoutNumerators.length < 2 || !market.payoutDenominator) {
      throw new CoreValidationError("finalized market has no verified payout vector");
    }
    if (market.payoutDenominator <= 0n) {
      throw new CoreValidationError("settlement payout denominator is invalid");
    }
    const selectedOutcome = side === "UP" ? 0 : 1;
    const won = selectedOutcome === market.winningOutcome;
    const edgeNumerator = (won ? scale * quantity : 0n) - weightedPriceNumerator;
    const payoutRaw = quantity * scale * market.payoutNumerators[selectedOutcome]!
      / (quantityScale * market.payoutDenominator);
    rounds.push({
      ...base,
      state: won ? "won" : "lost",
      roundPoints: rational(100n * edgeNumerator, scale * quantity),
      payoutRaw,
      returnRaw: payoutRaw - entryCostRaw,
    });
  }

  const chronological = rounds.sort((left, right) =>
    left.timestampSec < right.timestampSec ? -1 : left.timestampSec > right.timestampSec ? 1
      : left.fillTransactionHash.localeCompare(right.fillTransactionHash),
  );
  const settled = chronological.filter((round) => round.state === "won" || round.state === "lost");
  const wins = settled.filter((round) => round.state === "won").length;
  let currentStreak = 0;
  let bestStreak = 0;
  let cumulative = 0n;
  let peak = 0n;
  let maximumDrawdownRaw = 0n;
  let points = rational(0n, 1n);
  for (const round of settled) {
    if (round.state === "won") {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
    cumulative += round.returnRaw!;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maximumDrawdownRaw) maximumDrawdownRaw = drawdown;
    points = add(points, round.roundPoints!);
  }
  const settledCount = settled.length;
  const averagePoints = settledCount > 0
    ? rational(points.numerator, points.denominator * BigInt(settledCount))
    : null;
  const skillScore = averagePoints
    ? add(rational(50n, 1n), rational(averagePoints.numerator, averagePoints.denominator * 2n))
    : null;
  return {
    account: input.account,
    formulaVersion: SCORE_FORMULA_VERSION,
    state: settledCount === 0 ? "empty" : settledCount < 10 ? "provisional" : "verified",
    rounds: chronological.reverse(),
    settledCount,
    wins,
    accuracy: settledCount > 0 ? rational(BigInt(wins), BigInt(settledCount)) : null,
    currentStreak,
    bestStreak,
    totalReturnRaw: cumulative,
    maximumDrawdownRaw,
    collateral,
    collateralDecimals,
    skillScore,
  };
}
