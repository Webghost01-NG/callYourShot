import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [somniaShannon],
  // QR pairing is suspended pending a verified end-to-end mobile acceptance run.
  // Keep injected providers (including discovered browser wallets) available.
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [somniaShannon.id]: http("https://dream-rpc.somnia.network/"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
