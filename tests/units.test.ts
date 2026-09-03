import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOrderUnits,
  ceilToIncrement,
  floorToIncrement,
  maximumBuyCost,
} from "../src/core/units.js";

const constraints = {
  tickSize: 1_000n,
  lotSize: 1_000n,
  minQuantity: 1_000n,
  priceScale: 1_000_000n,
};

test("quantizes exact bigint values without floats", () => {
  assert.equal(floorToIncrement(12_345n, 1_000n), 12_000n);
  assert.equal(ceilToIncrement(12_345n, 1_000n), 13_000n);
  assert.equal(ceilToIncrement(12_000n, 1_000n), 12_000n);
});

test("accepts aligned order units", () => {
  assert.doesNotThrow(() => assertOrderUnits(620_000n, 10_000n, constraints));
});

test("rejects invalid price and quantity units", () => {
  assert.throws(() => assertOrderUnits(620_001n, 10_000n, constraints), /tick/);
  assert.throws(() => assertOrderUnits(620_000n, 500n, constraints), /minimum/);
  assert.throws(() => assertOrderUnits(1_000_000n, 10_000n, constraints), /between/);
});

test("rounds maximum collateral cost upward", () => {
  assert.equal(maximumBuyCost(333_333n, 1_000_001n, 1_000_000n), 333_334n);
});
