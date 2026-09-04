import { CoreValidationError } from "../core/errors.js";

export function parseDecimalUnits(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new CoreValidationError("Enter a valid positive amount.");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new CoreValidationError(`Use no more than ${decimals} decimal places.`);
  }
  const result = BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (result <= 0n) throw new CoreValidationError("Amount must be greater than zero.");
  return result;
}

export function formatUnits(value: bigint, decimals: number, places = 2): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").slice(0, places);
  return places === 0 ? whole.toString() : `${whole}.${fraction.padEnd(places, "0")}`;
}
