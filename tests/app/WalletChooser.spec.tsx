import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletChooser } from "../../src/app/WalletChooser.js";

describe("WalletChooser", () => {
  afterEach(cleanup);

  it("presents separate browser and mobile connection paths", async () => {
    const onChoose = vi.fn();
    render(<WalletChooser
      choices={[
        { id: "injected", name: "MetaMask", type: "injected" },
        { id: "walletConnect", name: "WalletConnect", type: "walletConnect" },
      ]}
      connecting={false}
      onChoose={onChoose}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole("dialog", { name: "Choose your wallet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /MetaMask.*wallet extension/i })).toBeTruthy();
    const mobile = screen.getByRole("button", { name: /Mobile wallet or QR code/i });
    await userEvent.click(mobile);
    expect(onChoose).toHaveBeenCalledWith("walletConnect");
  });

  it("makes an unavailable mobile path explicit and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<WalletChooser
      choices={[{ id: "injected", name: "Browser wallet", type: "injected" }]}
      connecting={false}
      onChoose={vi.fn()}
      onClose={onClose}
    />);

    expect(screen.getByText(/Mobile\/QR connection is not configured/i)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
