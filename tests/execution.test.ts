import assert from "node:assert/strict";
import test from "node:test";
import { verifyFilledExecution } from "../src/core/execution.js";

const hash = `0x${"1".repeat(64)}` as const;

test("distinguishes a mined fill from transaction inclusion", () => {
  const result = verifyFilledExecution({
    transactionHash: hash,
    receiptStatus: "success",
    fills: [
      { takerOrderId: 1n, makerOrderId: 2n, quantityFilled: 2n, fillPrice: 400n },
      { takerOrderId: 1n, makerOrderId: 3n, quantityFilled: 3n, fillPrice: 600n },
    ],
  });
  assert.equal(result.totalQuantity, 5n);
  assert.equal(result.weightedPriceNumerator, 2_600n);
  assert.equal(result.averageFillPrice, 520n);
});

test("rejects reverted and unfilled transactions", () => {
  assert.throws(() => verifyFilledExecution({
    transactionHash: hash,
    receiptStatus: "reverted",
    fills: [],
  }), /reverted/);
  assert.throws(() => verifyFilledExecution({
    transactionHash: hash,
    receiptStatus: "success",
    fills: [],
  }), /did not fill/);
});
