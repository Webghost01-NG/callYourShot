import type { Hex } from "viem";
import { CoreValidationError } from "./errors.js";

export interface VerifiedFill {
  takerOrderId: bigint;
  makerOrderId: bigint;
  quantity: bigint;
  price: bigint;
}

export interface VerifiedExecution {
  transactionHash: Hex;
  fills: VerifiedFill[];
  totalQuantity: bigint;
  weightedPriceNumerator: bigint;
  averageFillPrice: bigint;
}

export function verifyFilledExecution(input: {
  transactionHash: Hex;
  receiptStatus: "success" | "reverted";
  fills: readonly {
    takerOrderId: bigint;
    makerOrderId: bigint;
    quantityFilled: bigint;
    fillPrice: bigint;
  }[];
}): VerifiedExecution {
  if (input.receiptStatus !== "success") {
    throw new CoreValidationError("order transaction reverted");
  }
  if (input.fills.length === 0) {
    throw new CoreValidationError("mined order did not fill");
  }
  const fills = input.fills.map((fill) => {
    if (fill.quantityFilled <= 0n || fill.fillPrice <= 0n) {
      throw new CoreValidationError("fill contains a non-positive quantity or price");
    }
    return {
      takerOrderId: fill.takerOrderId,
      makerOrderId: fill.makerOrderId,
      quantity: fill.quantityFilled,
      price: fill.fillPrice,
    };
  });
  const totalQuantity = fills.reduce((sum, fill) => sum + fill.quantity, 0n);
  const weightedPriceNumerator = fills.reduce(
    (sum, fill) => sum + fill.price * fill.quantity,
    0n,
  );
  return {
    transactionHash: input.transactionHash,
    fills,
    totalQuantity,
    weightedPriceNumerator,
    averageFillPrice: weightedPriceNumerator / totalQuantity,
  };
}
