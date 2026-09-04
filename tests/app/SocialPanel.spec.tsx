import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SocialPanel } from "../../src/app/SocialPanel.js";

describe("social competition panel", () => {
  it("labels missing persistence configuration without inventing players", () => {
    render(
      <SocialPanel
        config={null}
        configError={null}
        connected={false}
        onConnect={async () => undefined}
      />,
    );
    expect(screen.getByText("Social league is not configured")).toBeTruthy();
    expect(screen.getByText(/No sample players are shown/)).toBeTruthy();
  });
});
