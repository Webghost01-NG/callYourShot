import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { walletConnectionEnvironment } from "./walletEnvironment.js";

const mobileConnectors = walletConnectionEnvironment.reownProjectId
  ? [walletConnect({
    projectId: walletConnectionEnvironment.reownProjectId,
    showQrModal: true,
    metadata: {
      name: "Call Your Shot",
      description: "A verifiable prediction skill league powered by DreamDEX on Somnia.",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    },
  })]
  : [];

export const wagmiConfig = createConfig({
  chains: [somniaShannon],
  connectors: [injected({ shimDisconnect: true }), ...mobileConnectors],
  transports: {
    [somniaShannon.id]: http("https://dream-rpc.somnia.network/"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
