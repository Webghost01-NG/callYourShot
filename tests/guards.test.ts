import assert from "node:assert/strict";
import test from "node:test";
import { assertFinalized, assertTradingWithHeadroom } from "../src/core/guards.js";

test("allows only a live market with sufficient headroom", () => {
  assert.doesNotThrow(() => assertTradingWithHeadroom({
    status: 1,
    expirySec: 1_300n,
    nowSec: 1_000n,
    minimumHeadroomSec: 300n,
  }));
  assert.throws(() => assertTradingWithHeadroom({
    status: 2,
    expirySec: 1_300n,
    nowSec: 1_000n,
    minimumHeadroomSec: 300n,
  }), /Trading/);
  assert.throws(() => assertTradingWithHeadroom({
    status: 1,
    expirySec: 1_299n,
    nowSec: 1_000n,
    minimumHeadroomSec: 300n,
  }), /headroom/);
});

test("requires a finalized terminal market", () => {
  assert.doesNotThrow(() => assertFinalized({
    finalized: true,
    isResolved: true,
    isVoided: false,
  }));
  assert.throws(() => assertFinalized({
    finalized: false,
    isResolved: true,
    isVoided: false,
  }), /not finalized/);
});
