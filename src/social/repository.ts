import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { getAddress, isAddress, type Address, type Hex, type WalletClient } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import type { SocialConfig } from "./config.js";
import type { Database } from "./database.js";
import type { Challenge, ChallengeStatus, LeagueProfile } from "./model.js";

const MARKET_ID = /^0x[0-9a-fA-F]{64}$/;
const DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,23}$/;
const PROFILE_PAGE_SIZE = 100;
const MAX_PROFILE_PAGES = 10;
const RESERVED_NAMES = new Set([
  "admin", "administrator", "moderator", "support", "somnia", "dreamdex",
  "call your shot", "callyourshot",
]);

function assertDate(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is not a valid timestamp.`);
  return value;
}

export function verifiedWeb3Wallet(user: Pick<User, "identities">): Address | null {
  const identity = user.identities?.find((item) =>
    item.provider === "web3"
    && item.identity_data?.custom_claims?.chain === "ethereum"
    && Number(item.identity_data?.custom_claims?.network) === somniaShannon.id
    && typeof item.identity_data.custom_claims.address === "string"
    && isAddress(item.identity_data.custom_claims.address),
  );
  return identity ? getAddress(identity.identity_data!.custom_claims!.address as string) : null;
}

type PublicProfileRow = Omit<
  Database["public"]["Tables"]["league_profiles"]["Row"],
  "user_id"
>;

type PublicChallengeRow = Omit<
  Database["public"]["Tables"]["challenges"]["Row"],
  "creator_user_id" | "opponent_user_id"
>;

function mapProfile(row: PublicProfileRow): LeagueProfile {
  if (!isAddress(row.wallet_address)) throw new Error("A league profile has an invalid wallet address.");
  if (row.formula_version !== "CYS-EDGE-v1") throw new Error("A league profile uses an unsupported formula.");
  return {
    id: row.id,
    walletAddress: getAddress(row.wallet_address),
    displayName: row.display_name,
    enrolledAt: assertDate(row.enrolled_at, "Enrollment time"),
    formulaVersion: row.formula_version,
    updatedAt: assertDate(row.updated_at, "Profile update time"),
  };
}

function mapChallenge(row: PublicChallengeRow): Challenge {
  if (!isAddress(row.creator_wallet) || !isAddress(row.invited_wallet)) {
    throw new Error("A challenge has an invalid participant wallet.");
  }
  if (row.opponent_wallet !== null && !isAddress(row.opponent_wallet)) {
    throw new Error("A challenge has an invalid opponent wallet.");
  }
  if (!MARKET_ID.test(row.market_id)) throw new Error("A challenge has an invalid market ID.");
  if (!(["open", "accepted", "cancelled"] as string[]).includes(row.status)) {
    throw new Error("A challenge has an unsupported status.");
  }
  return {
    id: row.id,
    creatorWallet: getAddress(row.creator_wallet),
    invitedWallet: getAddress(row.invited_wallet),
    opponentWallet: row.opponent_wallet ? getAddress(row.opponent_wallet) : null,
    marketId: row.market_id.toLowerCase() as Hex,
    status: row.status as ChallengeStatus,
    createdAt: assertDate(row.created_at, "Challenge creation time"),
    acceptedAt: row.accepted_at ? assertDate(row.accepted_at, "Challenge acceptance time") : null,
    cancelledAt: row.cancelled_at ? assertDate(row.cancelled_at, "Challenge cancellation time") : null,
  };
}

export function normalizeDisplayName(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!DISPLAY_NAME.test(normalized)) {
    throw new Error("Display names must be 2–24 letters, numbers, spaces, dots, dashes, or underscores.");
  }
  if (RESERVED_NAMES.has(normalized.toLowerCase())) throw new Error("That display name is reserved.");
  return normalized;
}

export class SupabaseSocialRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(config: SocialConfig) {
    this.client = createClient<Database>(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }

  async authenticatedWallet(): Promise<Address | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error) {
      if (/session|token/i.test(error.message)) return null;
      throw error;
    }
    return data.user ? verifiedWeb3Wallet(data.user) : null;
  }

  async signIn(walletClient: WalletClient, expectedAddress: Address): Promise<Address> {
    const account = walletClient.account;
    if (!account || account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error("The connected wallet changed before sign-in.");
    }
    const now = new Date();
    const message = createSiweMessage({
      address: account.address,
      chainId: somniaShannon.id,
      domain: window.location.host,
      uri: window.location.origin,
      version: "1",
      nonce: generateSiweNonce(),
      issuedAt: now,
      expirationTime: new Date(now.getTime() + 5 * 60_000),
      statement: "Sign in to Call Your Shot. This does not authorize a trade or transfer funds.",
    });
    const signature = await walletClient.signMessage({ account, message });
    const { data, error } = await this.client.auth.signInWithWeb3({
      chain: "ethereum",
      message,
      signature,
    });
    if (error) throw error;
    const verified = verifiedWeb3Wallet(data.user);
    if (!verified || verified.toLowerCase() !== expectedAddress.toLowerCase()) {
      await this.client.auth.signOut({ scope: "local" });
      throw new Error("Supabase returned a different Web3 identity than the connected wallet.");
    }
    return verified;
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }

  async listProfiles(): Promise<LeagueProfile[]> {
    const profiles: LeagueProfile[] = [];
    for (let page = 0; page < MAX_PROFILE_PAGES; page += 1) {
      const from = page * PROFILE_PAGE_SIZE;
      const { data, error } = await this.client.from("league_profiles")
        .select("id,wallet_address,display_name,enrolled_at,formula_version,updated_at")
        .order("enrolled_at", { ascending: true })
        .range(from, from + PROFILE_PAGE_SIZE - 1);
      if (error) throw error;
      profiles.push(...data.map(mapProfile));
      if (data.length < PROFILE_PAGE_SIZE) return profiles;
    }
    throw new Error("The league exceeds the safe browser reconciliation limit.");
  }

  async enroll(displayName: string): Promise<string> {
    const { data, error } = await this.client.rpc("enroll_in_league", {
      p_display_name: normalizeDisplayName(displayName),
    });
    if (error) throw error;
    return data;
  }

  async updateDisplayName(displayName: string): Promise<string> {
    const { data, error } = await this.client.rpc("update_display_name", {
      p_display_name: normalizeDisplayName(displayName),
    });
    if (error) throw error;
    return data;
  }

  async createChallenge(marketId: Hex, invitedWallet: string): Promise<string> {
    if (!MARKET_ID.test(marketId)) throw new Error("The live market ID is invalid.");
    if (!isAddress(invitedWallet)) throw new Error("Enter a valid enrolled wallet address.");
    const { data, error } = await this.client.rpc("create_challenge", {
      p_market_id: marketId.toLowerCase(),
      p_invited_wallet: getAddress(invitedWallet).toLowerCase(),
    });
    if (error) throw error;
    return data;
  }

  async getChallenge(challengeId: string): Promise<Challenge | null> {
    const { data, error } = await this.client.from("challenges")
      .select("id,creator_wallet,invited_wallet,opponent_wallet,market_id,status,created_at,accepted_at,cancelled_at")
      .eq("id", challengeId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapChallenge(data) : null;
  }

  async acceptChallenge(challengeId: string): Promise<string> {
    const { data, error } = await this.client.rpc("accept_challenge", { p_challenge_id: challengeId });
    if (error) throw error;
    return data;
  }

  async cancelChallenge(challengeId: string): Promise<string> {
    const { data, error } = await this.client.rpc("cancel_challenge", { p_challenge_id: challengeId });
    if (error) throw error;
    return data;
  }

  close(): void {
    this.client.removeAllChannels();
  }
}
