import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletChooser } from "../../src/app/WalletChooser.js";

describe("WalletChooser", () => {
  afterEach(cleanup);

  it("keeps keyboard focus inside an empty chooser", async () => {
    render(<WalletChooser choices={[]} connecting={false} onChoose={vi.fn()} onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "Close wallet chooser" });
    expect(document.activeElement).toBe(close);
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(close);
  });

  it("retains focus while every control is disabled during connection", async () => {
    const onClose = vi.fn();
    const props = { choices: [{ id: "injected", name: "Browser wallet", type: "injected" }], onChoose: vi.fn(), onClose };
    const { rerender } = render(<WalletChooser {...props} connecting={false} />);
    rerender(<WalletChooser {...props} connecting />);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    await userEvent.tab();
    expect(document.activeElement).toBe(dialog);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    rerender(<WalletChooser {...props} connecting={false} />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close wallet chooser" }));
  });

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

    expect(screen.getByText(/QR pairing is temporarily unavailable/i)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
