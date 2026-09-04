import { getAddress, isAddress, type Address, type Hex } from "viem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKET_ID = /^0x[0-9a-fA-F]{64}$/;

export type SocialRoute =
  | { kind: "challenge"; challengeId: string }
  | { kind: "receipt"; wallet: Address; marketId: Hex }
  | { kind: "league" };

export function readSocialRoute(search: string): SocialRoute {
  const params = new URLSearchParams(search);
  const challengeId = params.get("challenge");
  if (challengeId && UUID.test(challengeId)) return { kind: "challenge", challengeId };
  const wallet = params.get("receiptWallet");
  const marketId = params.get("receiptMarket");
  if (wallet && marketId && isAddress(wallet) && MARKET_ID.test(marketId)) {
    return { kind: "receipt", wallet: getAddress(wallet), marketId: marketId.toLowerCase() as Hex };
  }
  return { kind: "league" };
}

function cleanUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  return url;
}

export function challengeUrl(baseUrl: string, challengeId: string): string {
  if (!UUID.test(challengeId)) throw new Error("Challenge ID is invalid.");
  const url = cleanUrl(baseUrl);
  url.searchParams.set("challenge", challengeId);
  return url.toString();
}

export function receiptUrl(baseUrl: string, wallet: Address, marketId: Hex): string {
  if (!isAddress(wallet) || !MARKET_ID.test(marketId)) throw new Error("Receipt evidence key is invalid.");
  const url = cleanUrl(baseUrl);
  url.searchParams.set("receiptWallet", getAddress(wallet));
  url.searchParams.set("receiptMarket", marketId.toLowerCase());
  return url.toString();
}
