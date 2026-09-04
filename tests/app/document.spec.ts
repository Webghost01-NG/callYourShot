import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("application document metadata", () => {
  it("declares a repository-owned favicon that exists", async () => {
    const [document, favicon] = await Promise.all([
      readFile(resolve(process.cwd(), "index.html"), "utf8"),
      readFile(resolve(process.cwd(), "public/favicon.svg"), "utf8"),
    ]);

    expect(document).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
    expect(favicon).toMatch(/^<svg[^>]+viewBox="0 0 64 64"/);
    expect(favicon).toContain("#baff3c");
  });
});
