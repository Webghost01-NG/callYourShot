# Wallet connection and mobile handoff

Issue #47 adds a production connection path for users who are not already
inside a wallet browser.

## Supported paths

- **Browser wallet:** Wagmi's injected connector discovers an extension in the
  current browser.
- **Mobile wallet or QR code:** Wagmi's WalletConnect connector opens Reown's
  wallet handoff. A mobile user can open an installed wallet; a desktop user can
  scan the QR code with a phone.

The chooser always explains that connecting alone cannot approve a trade or
move funds. The application still verifies Somnia Shannon (chain ID `50312`),
invalidates a reviewed call after any account or network change, refreshes the
exact selected market, and asks the wallet to sign each bounded write.

## Public configuration

Create an application in the Reown dashboard and set its public project ID in
every intended Vercel environment:

```bash
VITE_REOWN_PROJECT_ID=<public-project-id>
```

This identifier is safe to expose in a browser bundle. It is not a private key
or wallet secret. The app validates its shape before registering WalletConnect.
If the value is missing or invalid, mobile/QR connection is disabled and the
chooser says so; the injected-wallet path remains available.

Configure the deployed domain in the Reown project allowlist. Do not commit a
real project ID to the repository.

## Manual release check

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
