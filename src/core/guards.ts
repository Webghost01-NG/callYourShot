import { CoreValidationError } from "./errors.js";

export const MARKET_STATUS = {
  LISTED: 0,
  TRADING: 1,
  LOCKED: 2,
  SETTLING: 3,
  RESOLVED: 4,
  VOIDED: 5,
} as const;

export function assertTradingWithHeadroom(input: {
  status: number;
  expirySec: bigint;
  nowSec: bigint;
  minimumHeadroomSec: bigint;
}): void {
  if (input.status !== MARKET_STATUS.TRADING) {
    throw new CoreValidationError("market is not in Trading status");
  }
  if (input.minimumHeadroomSec < 0n) {
    throw new CoreValidationError("minimum headroom cannot be negative");
  }
  if (input.expirySec - input.nowSec < input.minimumHeadroomSec) {
    throw new CoreValidationError("market does not have enough expiry headroom");
  }
}

export function assertFinalized(input: {
  finalized: boolean;
  isResolved: boolean;
  isVoided: boolean;
}): void {
  if (!input.finalized) throw new CoreValidationError("market is not finalized");
  if (!input.isResolved && !input.isVoided) {
    throw new CoreValidationError("finalized market has no terminal outcome");
  }
}
