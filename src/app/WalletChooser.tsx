import { useEffect, useRef } from "react";

export interface WalletChoice {
  id: string;
  name: string;
  type: string;
}

interface WalletChooserProps {
  choices: WalletChoice[];
  configurationError?: string;
  connecting: boolean;
  onChoose: (id: string) => void;
  onClose: () => void;
}

function walletCopy(choice: WalletChoice) {
  if (choice.type === "walletConnect") {
    return {
      label: "Mobile wallet or QR code",
      detail: "Open your wallet on this phone, or scan from another device.",
    };
  }
  return {
    label: choice.name || "Browser wallet",
    detail: "Use a wallet extension installed in this browser.",
  };
}

export function WalletChooser({
  choices,
  configurationError,
  connecting,
  onChoose,
  onClose,
}: WalletChooserProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape" && !connecting) onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
    };
  }, [connecting, onClose]);

  const hasMobileChoice = choices.some((choice) => choice.type === "walletConnect");

  return (
    <div className="wallet-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="wallet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-dialog-title"
        aria-describedby="wallet-dialog-description"
      >
        <div className="wallet-dialog-heading">
          <div>
            <p className="eyebrow">Non-custodial connection</p>
            <h2 id="wallet-dialog-title">Choose your wallet</h2>
          </div>
          <button type="button" className="wallet-dialog-close" onClick={onClose} disabled={connecting} aria-label="Close wallet chooser">×</button>
        </div>
        <p id="wallet-dialog-description">Your wallet stays in control. Connecting does not approve a trade or move funds.</p>
        <div className="wallet-choice-list">
          {choices.map((choice, index) => {
            const copy = walletCopy(choice);
            return (
              <button
                key={`${choice.type}:${choice.id}`}
                type="button"
                className="wallet-choice"
                onClick={() => onChoose(choice.id)}
                disabled={connecting}
                autoFocus={index === 0}
              >
                <span aria-hidden="true">{choice.type === "walletConnect" ? "↗" : "⌁"}</span>
                <span><strong>{copy.label}</strong><small>{copy.detail}</small></span>
                <i aria-hidden="true">→</i>
              </button>
            );
          })}
        </div>
        {!hasMobileChoice && (
          <p className="wallet-mobile-unavailable" role="status">
            {configurationError ?? "Mobile/QR connection is not configured for this deployment yet."}
          </p>
        )}
      </section>
    </div>
  );
}
