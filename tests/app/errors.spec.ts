import { describe, expect, it } from "vitest";
import {
  isUserRejectedRequest,
  publicErrorMessage,
  transactionFailureMessage,
} from "../../src/app/errors.js";

const rawRejection = new Error(
  "User rejected the request. Request Arguments: chain: Somnia Testnet data: 0x095ea7b3000000000000000000000000 gas: 1667540 Details: MetaMask Tx Signature: User denied transaction signature. Version: viem@2.56.3",
);

describe("wallet error presentation", () => {
  it("recognizes nested and provider-code rejections", () => {
    expect(isUserRejectedRequest(rawRejection)).toBe(true);
    expect(isUserRejectedRequest({ code: 4001 })).toBe(true);
    expect(isUserRejectedRequest(new Error("RPC temporarily unavailable"))).toBe(false);
  });

  it("does not expose provider request dumps", () => {
    const message = publicErrorMessage(rawRejection, "The request was not completed.");
    expect(message).toBe("The request was not completed.");
    expect(message).not.toMatch(/0x095e|viem|gas:/i);
  });

  it("explains a rejected first approval without claiming a transaction", () => {
    const message = transactionFailureMessage(rawRejection, {
      approvalRequired: true,
      approvalSubmitted: false,
      approvalConfirmed: false,
      orderSubmitted: false,
      approvalDescription: "0.99 tUSDC",
    });
    expect(message).toMatch(/cancelled the bounded token approval/i);
    expect(message).toMatch(/nothing was submitted/i);
    expect(message).not.toMatch(/request arguments|viem/i);
  });

  it("discloses a remaining bounded approval when the order is rejected", () => {
    const message = transactionFailureMessage(rawRejection, {
      approvalRequired: true,
      approvalSubmitted: true,
      approvalConfirmed: true,
      orderSubmitted: false,
      approvalDescription: "0.99 tUSDC",
    });
    expect(message).toMatch(/approval succeeded/i);
    expect(message).toMatch(/no order was sent/i);
    expect(message).toMatch(/0\.99 tUSDC may remain approved/i);
  });

  it("warns against retrying when an order hash already exists", () => {
    const message = transactionFailureMessage(new Error("Receipt lookup failed"), {
      approvalRequired: false,
      approvalSubmitted: false,
      approvalConfirmed: false,
      orderSubmitted: true,
      approvalDescription: "0.99 tUSDC",
    });
    expect(message).toMatch(/order was submitted/i);
    expect(message).toMatch(/check the order transaction before retrying/i);
  });

  it("describes a verified no-fill without calling it an interrupted verification", () => {
    const message = transactionFailureMessage(new Error("mined order did not fill"), {
      approvalRequired: true,
      approvalSubmitted: true,
      approvalConfirmed: true,
      orderSubmitted: true,
      approvalDescription: "0.99 tUSDC",
    });
    expect(message).toMatch(/mined, but no DreamDEX fill was found/i);
    expect(message).toMatch(/No prediction was recorded/i);
    expect(message).not.toMatch(/verification could not finish/i);
  });
});
