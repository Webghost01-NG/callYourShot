interface ErrorLike {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
}

const PROVIDER_REJECTION_CODES = new Set([4001, "4001", "ACTION_REJECTED"]);
const PROVIDER_DUMP = /request arguments:|transaction request:|details:|version:\s*viem|metamask tx signature|\bdata:\s*0x[0-9a-f]{16,}|\bgas:\s*\d+/i;

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return chain;
}

export function isUserRejectedRequest(error: unknown): boolean {
  return errorChain(error).some((item) => {
    if (PROVIDER_REJECTION_CODES.has(item.code as number | string)) return true;
    const name = typeof item.name === "string" ? item.name : "";
    const message = typeof item.message === "string" ? item.message : "";
    return /userrejectedrequest/i.test(name)
      || /user (?:rejected|denied)|rejected (?:the )?request|denied transaction signature/i.test(message);
  });
}

export function publicErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error && typeof error.message === "string"
    ? error.message.trim()
    : "";
  if (!message || message.length > 280 || PROVIDER_DUMP.test(message)) return fallback;
  return message;
}

export interface TransactionProgressSnapshot {
  approvalRequired: boolean;
  approvalSubmitted: boolean;
  approvalConfirmed: boolean;
  orderSubmitted: boolean;
  approvalDescription: string;
}

export function transactionFailureMessage(
  error: unknown,
  progress: TransactionProgressSnapshot,
): string {
  if (isUserRejectedRequest(error)) {
    if (progress.approvalConfirmed) {
      return `The bounded token approval succeeded, but you cancelled the DreamDEX order. No order was sent. ${progress.approvalDescription} may remain approved for this verified pool.`;
    }
    if (progress.approvalSubmitted) {
      return "The approval transaction was already submitted before the wallet request was cancelled. Check its status before trying again; no DreamDEX order was sent.";
    }
    if (progress.approvalRequired) {
      return "You cancelled the bounded token approval. Nothing was submitted, no gas was spent, and no funds moved.";
    }
    return "You cancelled the DreamDEX order. Nothing was submitted, no gas was spent, and no funds moved.";
  }

  const safe = publicErrorMessage(
    error,
    "The wallet or network could not complete this request. No verified call was recorded.",
  );
  if (/did not fill/i.test(safe)) {
    return "The order transaction was mined, but no DreamDEX fill was found. No prediction was recorded.";
  }
  if (progress.orderSubmitted) {
    return `The DreamDEX order was submitted, but verification could not finish. Check the order transaction before retrying. ${safe}`.trim();
  }
  if (progress.approvalConfirmed) {
    return `${safe} No DreamDEX order was sent. ${progress.approvalDescription} may remain approved for this verified pool.`;
  }
  if (progress.approvalSubmitted) {
    return `The approval transaction was submitted, but its final status could not be verified. Check it before retrying; no DreamDEX order was sent. ${safe}`;
  }
  return safe;
}
