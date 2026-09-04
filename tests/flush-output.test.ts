import assert from "node:assert/strict";
import test from "node:test";
import { flushOutputAndExit } from "../scripts/flush-output.js";

test("exits only after the complete CLI output is flushed", () => {
  const events: string[] = [];
  const report = "{\n  \"settled\": 1\n}\n";

  flushOutputAndExit(
    report,
    0,
    (output, onFlushed) => {
      events.push(`write:${output}`);
      onFlushed();
    },
    (code) => events.push(`exit:${code}`),
  );

  assert.deepEqual(events, [`write:${report}`, "exit:0"]);
});
