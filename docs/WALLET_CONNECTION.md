# Wallet connection and mobile handoff

Current release: `4236cda`. QR pairing is suspended following repeated blank
WalletConnect panels. Issue #47's original implementation is historical, not a
claim that mobile/QR acceptance is complete.

## Supported paths

- **Browser wallet:** Wagmi's injected connector discovers an extension in the
  current browser.
- **Mobile wallet or QR code:** unavailable in the current release. Do not use
  it in the submission demo or describe it as working.
- **Wallet built-in browser:** may expose an injected provider; compatibility
  requires a separate real-device check and is not claimed here.

The chooser always explains that connecting alone cannot approve a trade or
move funds. The application still verifies Somnia Shannon (chain ID `50312`),
invalidates a reviewed call after any account or network change, refreshes the
exact selected market, and asks the wallet to sign each bounded write.

## Re-enablement reference (not active configuration)

Setting a project ID alone does not re-enable QR. The connector was removed
from registration; restoring it requires a reviewed change and successful
desktop QR and mobile-handoff acceptance evidence first.

Create an application in the Reown dashboard and set its public project ID in
every intended Vercel environment:

```bash
VITE_REOWN_PROJECT_ID=<public-project-id>
```

This identifier is safe to expose in a browser bundle. It is not a private key
or wallet secret. The retained environment parser validates its shape, but the
current app does not register WalletConnect regardless of this value.

Configure the deployed domain in the Reown project allowlist. Do not commit a
real project ID to the repository.

## Acceptance procedure before restoring QR

1. Open the production deployment in desktop Chrome with a supported extension.
2. Choose **Browser wallet**, connect, and confirm the address is correct.
3. Switch away from Somnia Shannon and verify the app requests chain `50312`
   before it can prepare a call.
4. Open the production deployment in mobile Chrome or Safari.
5. Choose **Mobile wallet or QR code**, complete the wallet handoff, and return
   to the same browser tab.
6. Verify the displayed address and reject a testnet transaction; the app must
   report the cancellation without claiming submission or a fill.
7. On desktop, scan the QR code with a separate phone and repeat the address and
   cancellation checks.

The target-browser portion cannot be certified by unit tests. Record the real
devices, browsers, wallet names, and result in the release validation report.
