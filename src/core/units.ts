import { CoreValidationError } from "./errors.js";

export interface BookConstraints {
  tickSize: bigint;
  lotSize: bigint;
  minQuantity: bigint;
  priceScale: bigint;
}

export function assertPositive(value: bigint, field: string): void {
  if (value <= 0n) throw new CoreValidationError(`${field} must be positive`);
}

export function floorToIncrement(value: bigint, increment: bigint): bigint {
  assertPositive(increment, "increment");
  if (value < 0n) throw new CoreValidationError("value cannot be negative");
  return value - (value % increment);
}

export function ceilToIncrement(value: bigint, increment: bigint): bigint {
  const floor = floorToIncrement(value, increment);
  return floor === value ? value : floor + increment;
}

export function assertOrderUnits(
  price: bigint,
  quantity: bigint,
  constraints: BookConstraints,
): void {
  assertPositive(constraints.priceScale, "priceScale");
  assertPositive(constraints.tickSize, "tickSize");
  assertPositive(constraints.lotSize, "lotSize");
  assertPositive(constraints.minQuantity, "minQuantity");
  if (price <= 0n || price >= constraints.priceScale) {
    throw new CoreValidationError("price must be between zero and one outcome unit");
  }
  if (price % constraints.tickSize !== 0n) {
    throw new CoreValidationError("price is not aligned to the pool tick size");
  }
  if (quantity < constraints.minQuantity) {
    throw new CoreValidationError("quantity is below the pool minimum");
  }
  if (quantity % constraints.lotSize !== 0n) {
    throw new CoreValidationError("quantity is not aligned to the pool lot size");
  }
}

export function maximumBuyCost(
  price: bigint,
  quantity: bigint,
  priceScale: bigint,
): bigint {
  assertPositive(price, "price");
  assertPositive(quantity, "quantity");
  assertPositive(priceScale, "priceScale");
  return (price * quantity + priceScale - 1n) / priceScale;
}
