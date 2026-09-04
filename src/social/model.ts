import type { Address, Hex } from "viem";

export interface LeagueProfile {
  id: string;
  walletAddress: Address;
  displayName: string | null;
  enrolledAt: string;
  formulaVersion: "CYS-EDGE-v1";
  updatedAt: string;
}

export type ChallengeStatus = "open" | "accepted" | "cancelled";

export interface Challenge {
  id: string;
  creatorWallet: Address;
  invitedWallet: Address;
  opponentWallet: Address | null;
  marketId: Hex;
  status: ChallengeStatus;
  createdAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
}
