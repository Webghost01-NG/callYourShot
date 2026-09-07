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

  it("publishes complete canonical and social-preview metadata", async () => {
    const [document, preview, previewPng] = await Promise.all([
      readFile(resolve(process.cwd(), "index.html"), "utf8"),
      readFile(resolve(process.cwd(), "public/social-preview.svg"), "utf8"),
      readFile(resolve(process.cwd(), "public/social-preview.png")),
    ]);

    expect(document).toContain('rel="canonical" href="https://call-your-shot-six.vercel.app/"');
    expect(document).toContain('property="og:image" content="https://call-your-shot-six.vercel.app/social-preview.png"');
    expect(document).toContain('name="twitter:card" content="summary_large_image"');
    expect(preview).toMatch(/^<svg[^>]+viewBox="0 0 1200 630"/);
    expect(previewPng.subarray(1, 4).toString()).toBe("PNG");
    expect(previewPng.readUInt32BE(16)).toBe(1_200);
    expect(previewPng.readUInt32BE(20)).toBe(630);
  });

  it("keeps sticky navigation outside an overflow scroll container", async () => {
    const styles = await readFile(resolve(process.cwd(), "src/app/styles.css"), "utf8");

    expect(styles).toMatch(/html\s*\{[^}]*scroll-padding-top:\s*106px/);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*overflow-x:\s*clip/);
    expect(styles).not.toMatch(/\.app-shell\s*\{[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.topbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/);
  });
});
