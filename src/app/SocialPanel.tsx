import { useCallback, useEffect, useMemo, useState } from "react";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { Address, Hex, WalletClient } from "viem";
import { formatRational, type ProfileRound } from "../core/profile.js";
import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import { buildLeagueBoard, type LeagueBoard, type VerifiedLeagueProfile } from "../social/leaderboard.js";
import type { SocialConfig } from "../social/config.js";
import type { Challenge, LeagueProfile } from "../social/model.js";
import {
  completedChallengeResult,
  deriveChallengeLifecycle,
  type ChallengeMarketState,
} from "../social/challenge.js";
import { SupabaseSocialRepository } from "../social/repository.js";
import { challengeUrl, readSocialRoute, receiptUrl, type SocialRoute } from "../social/share.js";
import type { BrowserDreamDexRuntime, LiveRound } from "./runtime.js";
import { callLabel } from "./marketLabels.js";

type SocialLoadState = "idle" | "loading" | "ready" | "error";
type SharedLoadState = "idle" | "loading" | "ready" | "not-found" | "error";

export type LeagueEnrollmentStatus = "disconnected" | "checking" | "enrolled" | "not-enrolled" | "unavailable";

export interface LeagueEnrollmentSnapshot {
  status: LeagueEnrollmentStatus;
  address?: Address;
}

interface SocialPanelProps {
  config: SocialConfig | null;
  configError: string | null;
  runtime?: BrowserDreamDexRuntime;
  round?: LiveRound;
  connected: boolean;
  address?: Address;
  walletClient?: WalletClient;
  onConnect: () => Promise<ConnectedWallet | null>;
  onEnrollmentChange?: (snapshot: LeagueEnrollmentSnapshot) => void;
  route?: SocialRoute;
  rounds?: readonly LiveRound[];
  marketDiscoveryState?: "loading" | "ready" | "empty" | "stale" | "error";
  onSelectMarket?: (marketId: Hex) => void;
}

export interface ConnectedWallet {
  address: Address;
  walletClient: WalletClient;
}

interface ChallengeEvidence {
  challenge: Challenge;
  creator: ProfileRound | null;
  opponent: ProfileRound | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The social service is unavailable.";
}

function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function nameOf(enrollment: LeagueProfile): string {
  return enrollment.displayName ?? shortAddress(enrollment.walletAddress);
}

function enrollmentStart(profile: LeagueProfile): bigint {
  return BigInt(Math.ceil(Date.parse(profile.enrolledAt) / 1_000));
}

function findRound(result: ReconciledProfile, marketId: Hex): ProfileRound | null {
  return result.profile.rounds.find((round) => round.marketId.toLowerCase() === marketId.toLowerCase()) ?? null;
}

function resultLabel(round: ProfileRound | null): string {
  if (!round) return "No verified call";
  const side = callLabel(round.question, round.side);
  if (round.state === "pending") return `${side} · awaiting result`;
  if (round.state === "void") return `${side} · void`;
  return `${side} · ${round.state}`;
}

function explorerTransaction(hash: Hex): string {
  return `${somniaShannon.blockExplorers.default.url}/tx/${hash}`;
}

async function reconcileEnrollments(
  runtime: BrowserDreamDexRuntime,
  enrollments: readonly LeagueProfile[],
): Promise<{ verified: VerifiedLeagueProfile[]; failed: number }> {
  const verified: VerifiedLeagueProfile[] = [];
  let failed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < enrollments.length) {
      const enrollment = enrollments[cursor++];
      if (!enrollment) return;
      try {
        const evidence = await runtime.loadPublicProfile(
          enrollment.walletAddress,
          enrollmentStart(enrollment),
        );
        if (evidence.evidenceGaps.some((gap) =>
          gap.kind === "fill" || gap.kind === "market" || gap.kind === "settlement",
        )) {
          failed += 1;
        } else {
          verified.push({ enrollment, evidence });
        }
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, enrollments.length) }, () => worker()));
  return { verified, failed };
}

export function SocialPanel({
  config,
  configError,
  runtime,
  round,
  connected,
  address,
  walletClient,
  onConnect,
  onEnrollmentChange,
  route: requestedRoute,
  rounds = [],
  marketDiscoveryState = "loading",
  onSelectMarket,
}: SocialPanelProps) {
  const repository = useMemo(() => config ? new SupabaseSocialRepository(config) : null, [config]);
  const parsedRoute = useMemo(() => readSocialRoute(window.location.search), []);
  const route = requestedRoute ?? parsedRoute;
  const [state, setState] = useState<SocialLoadState>(config ? "loading" : "idle");
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [authWallet, setAuthWallet] = useState<Address | null>(null);
  const [enrollments, setEnrollments] = useState<LeagueProfile[]>([]);
  const [board, setBoard] = useState<LeagueBoard>({ ranked: [], provisional: [] });
  const [failedProfiles, setFailedProfiles] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [invitee, setInvitee] = useState("");
  const [challengeLink, setChallengeLink] = useState<string>();
  const [receiptLink, setReceiptLink] = useState<string>();
  const [actionState, setActionState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [actionMessage, setActionMessage] = useState<string>();
  const [challengeEvidence, setChallengeEvidence] = useState<ChallengeEvidence>();
  const [challengeState, setChallengeState] = useState<SharedLoadState>(route.kind === "challenge" ? "loading" : "idle");
  const [challengeError, setChallengeError] = useState<string>();
  const [receiptRound, setReceiptRound] = useState<ProfileRound>();
  const [receiptState, setReceiptState] = useState<SharedLoadState>(route.kind === "receipt" ? "loading" : "idle");
  const [receiptError, setReceiptError] = useState<string>();

  const loadBoard = useCallback(async () => {
    if (!repository || !runtime) return;
    setState("loading");
    setProfilesLoaded(false);
    setError(undefined);
    try {
      const profiles = await repository.listProfiles();
      setEnrollments(profiles);
      setProfilesLoaded(true);
      const result = await reconcileEnrollments(runtime, profiles);
      setBoard(buildLeagueBoard(result.verified));
      setFailedProfiles(result.failed);
      setState("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setState("error");
    }
  }, [repository, runtime]);

  useEffect(() => {
    if (!repository) return;
    let active = true;
    void repository.authenticatedWallet().then((wallet) => {
      if (active) setAuthWallet(wallet);
    }).catch((cause) => {
      if (active) setError(errorMessage(cause));
    });
    return () => { active = false; repository.close(); };
  }, [repository]);

  useEffect(() => {
    if (repository && runtime) void loadBoard();
  }, [loadBoard, repository, runtime]);

  const enrollmentByWallet = useMemo(() => new Map(
    enrollments.map((item) => [item.walletAddress.toLowerCase(), item]),
  ), [enrollments]);
  const ownEnrollment = address ? enrollmentByWallet.get(address.toLowerCase()) : undefined;
  const ownEvidence = useMemo(() => [...board.ranked, ...board.provisional].find((item) =>
    address && item.enrollment.walletAddress.toLowerCase() === address.toLowerCase(),
  ), [address, board]);

  useEffect(() => {
    if (!onEnrollmentChange) return;
    if (!config) {
      onEnrollmentChange({ status: "unavailable" });
    } else if (!connected || !address) {
      onEnrollmentChange({ status: "disconnected" });
    } else if (ownEnrollment) {
      onEnrollmentChange({ status: "enrolled", address });
    } else if (state === "error") {
      onEnrollmentChange({ status: "unavailable", address });
    } else if (state === "ready") {
      onEnrollmentChange({ status: "not-enrolled", address });
    } else {
      onEnrollmentChange({ status: "checking", address });
    }
  }, [address, config, connected, onEnrollmentChange, ownEnrollment, state]);

  useEffect(() => {
    if (!repository || !runtime) return;
    if (state === "error") {
      if (route.kind === "challenge") {
        setChallengeError("Challenge verification is unavailable because the public league could not be loaded.");
        setChallengeState("error");
      }
      return;
    }
    if (!profilesLoaded) return;
    let active = true;
    if (route.kind === "challenge") {
      setChallengeEvidence(undefined);
      setChallengeError(undefined);
      setChallengeState("loading");
      void repository.getChallenge(route.challengeId).then(async (challenge) => {
        if (!challenge) {
          if (active) setChallengeState("not-found");
          return;
        }
        const creatorEnrollment = enrollmentByWallet.get(challenge.creatorWallet.toLowerCase());
        const opponentEnrollment = enrollmentByWallet.get(challenge.invitedWallet.toLowerCase());
        if (!creatorEnrollment) throw new Error("The challenge creator is no longer enrolled.");
        const creator = await runtime.loadPublicProfile(
          challenge.creatorWallet,
          enrollmentStart(creatorEnrollment),
        );
        const opponent = opponentEnrollment
          ? await runtime.loadPublicProfile(
              challenge.invitedWallet,
              enrollmentStart(opponentEnrollment),
            )
          : null;
        if (active) {
          setChallengeEvidence({
            challenge,
            creator: findRound(creator, challenge.marketId),
            opponent: opponent ? findRound(opponent, challenge.marketId) : null,
          });
          setChallengeState("ready");
        }
      }).catch((cause) => {
        if (active) {
          setChallengeError(errorMessage(cause));
          setChallengeState("error");
        }
      });
    }
    return () => { active = false; };
  }, [enrollmentByWallet, profilesLoaded, repository, route, runtime, state]);

  useEffect(() => {
    if (!runtime || route.kind !== "receipt") return;
    let active = true;
    setReceiptRound(undefined);
    setReceiptError(undefined);
    setReceiptState("loading");
    void runtime.loadPublicProfile(route.wallet)
      .then((profile) => {
        if (!active) return;
        const found = findRound(profile, route.marketId);
        if (!found) {
          setReceiptState("not-found");
          return;
        }
        setReceiptRound(found);
        setReceiptState("ready");
      })
      .catch((cause) => {
        if (active) {
          setReceiptError(errorMessage(cause));
          setReceiptState("error");
        }
      });
    return () => { active = false; };
  }, [route, runtime]);

  async function ensureLeagueIdentity(): Promise<Address> {
    let expectedAddress = address;
    let signer = walletClient;
    if (!connected || !expectedAddress || !signer) {
      const connection = await onConnect();
      if (!connection) throw new Error("Wallet connection did not complete.");
      expectedAddress = connection.address;
      signer = connection.walletClient;
    }
    let verified = authWallet;
    if (!verified || verified.toLowerCase() !== expectedAddress.toLowerCase()) {
      verified = await repository!.signIn(signer, expectedAddress);
      setAuthWallet(verified);
    }
    return verified;
  }

  async function joinLeague() {
    if (!repository) return;
    setActionState("working");
    setActionMessage(undefined);
    try {
      await ensureLeagueIdentity();
      if (ownEnrollment) await repository.updateDisplayName(displayName);
      else await repository.enroll(displayName);
      await loadBoard();
      setActionState("done");
      setActionMessage(ownEnrollment ? "Display name updated." : "You joined. Only calls made after this moment can rank.");
    } catch (cause) {
      setActionState("error");
      setActionMessage(errorMessage(cause));
    }
  }

  async function createChallenge() {
    if (!repository) return;
    setActionState("working");
    setActionMessage(undefined);
    try {
      if (!round) {
        throw new Error("A challenge needs a live DreamDEX round. The button will unlock when the next eligible round appears.");
      }
      await ensureLeagueIdentity();
      if (!ownEnrollment) throw new Error("Join the league before challenging a friend.");
      const id = await repository.createChallenge(round.market.marketId, invitee);
      const link = challengeUrl(window.location.href, id);
      setChallengeLink(link);
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        setActionState("done");
        setActionMessage("Challenge created. Your browser blocked automatic copying, so copy the visible link below.");
        return;
      }
      setActionState("done");
      setActionMessage("Challenge link copied. Both players use their own DreamDEX trade; Call Your Shot never holds funds.");
    } catch (cause) {
      setActionState("error");
      setActionMessage(errorMessage(cause));
    }
  }

  async function acceptChallenge() {
    if (!repository || !runtime || route.kind !== "challenge" || !challengeEvidence) return;
    setActionState("working");
    setActionMessage(undefined);
    try {
      const exactRound = await runtime.refreshRound(challengeEvidence.challenge.marketId);
      if (
        exactRound.market.marketId.toLowerCase() !== challengeEvidence.challenge.marketId.toLowerCase()
        || (exactRound.book.yesAsks.length === 0 && exactRound.book.noAsks.length === 0)
      ) {
        throw new Error("This challenge's Event Contract is no longer tradable.");
      }
      await ensureLeagueIdentity();
      await repository.acceptChallenge(route.challengeId);
      const refreshed = await repository.getChallenge(route.challengeId);
      if (refreshed && challengeEvidence) setChallengeEvidence({ ...challengeEvidence, challenge: refreshed });
      setActionState("done");
      setActionMessage("Challenge accepted. Make your independent call in the matching DreamDEX round.");
    } catch (cause) {
      setActionState("error");
      setActionMessage(errorMessage(cause));
    }
  }

  async function cancelChallenge() {
    if (!repository || route.kind !== "challenge") return;
    setActionState("working");
    setActionMessage(undefined);
    try {
      await ensureLeagueIdentity();
      await repository.cancelChallenge(route.challengeId);
      const refreshed = await repository.getChallenge(route.challengeId);
      if (refreshed && challengeEvidence) setChallengeEvidence({ ...challengeEvidence, challenge: refreshed });
      setActionState("done");
      setActionMessage("Challenge cancelled.");
    } catch (cause) {
      setActionState("error");
      setActionMessage(errorMessage(cause));
    }
  }

  async function copyReceipt(roundEvidence: ProfileRound) {
    if (!address) return;
    const link = receiptUrl(window.location.href, address, roundEvidence.marketId);
    setReceiptLink(link);
    try {
      await navigator.clipboard.writeText(link);
      setActionState("done");
      setActionMessage("Verified result link copied.");
    } catch {
      setActionState("done");
      setActionMessage("Result link created. Your browser blocked automatic copying, so copy the visible link below.");
    }
  }

  const latestSettled = ownEvidence?.evidence.profile.rounds.find((item) => item.state === "won" || item.state === "lost");
  const challenge = challengeEvidence?.challenge;
  const challengedRound = challenge ? rounds.find((item) =>
    item.market.marketId.toLowerCase() === challenge.marketId.toLowerCase()
    && item.market.expirySec * 1_000n > BigInt(Date.now())
    && (item.book.yesAsks.length > 0 || item.book.noAsks.length > 0),
  ) : undefined;
  const challengeMarketState: ChallengeMarketState = challengedRound
    ? "live"
    : marketDiscoveryState === "loading"
      ? "checking"
      : "unavailable";
  const challengeLifecycle = challenge && challengeEvidence ? deriveChallengeLifecycle({
    status: challenge.status,
    creator: challengeEvidence.creator,
    opponent: challengeEvidence.opponent,
    market: challengeMarketState,
  }) : undefined;
  const challengeResult = challengeLifecycle === "completed" && challengeEvidence?.creator && challengeEvidence.opponent
    ? completedChallengeResult(challengeEvidence.creator, challengeEvidence.opponent)
    : undefined;
  const canAccept = challengeLifecycle === "open"
    && challengeMarketState === "live"
    && address?.toLowerCase() === challenge?.invitedWallet.toLowerCase();
  const canCancel = challenge?.status === "open" && address?.toLowerCase() === challenge.creatorWallet.toLowerCase();
  const sharedRoute = route.kind !== "league";
  const heading = route.kind === "challenge"
    ? {
        eyebrow: "Direct friend challenge",
        title: "Answer the same event. Let DreamDEX prove both calls.",
        description: "Inspect the invitation first, then make your own independent trade if its exact Event Contract is still live.",
      }
    : route.kind === "receipt"
      ? {
          eyebrow: "Direct verified receipt",
          title: "Inspect this call from fill to settlement.",
          description: "This result is rebuilt from the wallet's real DreamDEX evidence, independently of current market liquidity.",
        }
      : {
          eyebrow: "Skill league",
          title: "Compete on proof, not bankroll.",
          description: "Scores are rebuilt from real DreamDEX fills after enrollment. Spending more never improves rank.",
        };

  useEffect(() => {
    if (challengedRound && onSelectMarket) onSelectMarket(challengedRound.market.marketId);
  }, [challengedRound, onSelectMarket]);

  const receiptCard = route.kind === "receipt" ? (
    <SharedReceiptCard
      wallet={route.wallet}
      state={receiptState}
      round={receiptRound}
      error={receiptError}
    />
  ) : null;

  if (!config) {
    return (
      <section className={sharedRoute ? "social-section shared-route-section" : "social-section"} id="league" aria-labelledby="league-title">
        <div className="section-heading"><span className="section-index">03</span><div><p className="eyebrow">{heading.eyebrow}</p><h2 id="league-title">{heading.title}</h2><p>{heading.description}</p></div></div>
        {receiptCard ?? <div className="profile-empty"><strong>{sharedRoute ? "This shared proof cannot be loaded" : "Social league is not configured"}</strong><span>{configError ?? "Add the public Supabase URL and publishable key to enable real enrollments. No sample players are shown."}</span></div>}
        {route.kind === "receipt" && <p className="formula-note">The social league is unavailable, but this public receipt is reconstructed directly from DreamDEX and does not depend on Supabase.</p>}
      </section>
    );
  }

  return (
    <section className={sharedRoute ? "social-section shared-route-section" : "social-section"} id="league" aria-labelledby="league-title">
      <div className="section-heading">
        <span className="section-index">03</span>
        <div><p className="eyebrow">{heading.eyebrow}</p><h2 id="league-title">{heading.title}</h2><p>{heading.description}</p></div>
        <button className="secondary refresh-profile" onClick={() => void loadBoard()} disabled={state === "loading"}>Refresh board</button>
      </div>

      {receiptCard}

      {route.kind === "challenge" && (
        <article className="share-card">
          <p className="eyebrow">Friend challenge</p>
          {challengeState === "loading" && <span aria-live="polite">Rebuilding both records from DreamDEX…</span>}
          {challengeState === "not-found" && <span role="status">This challenge was not found or is no longer available.</span>}
          {challengeState === "error" && <span role="alert">{challengeError ?? "This challenge could not be verified."}</span>}
          {challengeState === "ready" && challenge && challengeEvidence && <><h3>{shortAddress(challenge.creatorWallet)} vs {shortAddress(challenge.invitedWallet)}</h3><p>This app compares independent trades in one market and never escrows funds.</p><ChallengeLifecycleNotice lifecycle={challengeLifecycle!} result={challengeResult} creator={challenge.creatorWallet} opponent={challenge.invitedWallet} />{challengeMarketState === "checking" && <p className="shared-market-state" role="status">Checking whether this exact Event Contract is still tradable…</p>}{challengeMarketState === "live" && challengeLifecycle !== "completed" && <p className="shared-market-state live" role="status">Exact Event Contract found and selected. <a href="#arena">Go to the matching market ↓</a></p>}{challengeMarketState === "unavailable" && challengeLifecycle !== "completed" && <p className="shared-market-state unavailable" role="status">This exact Event Contract is no longer in the verified live lobby. It may have locked or be temporarily unavailable, so no replacement market has been selected.</p>}<div className="challenge-sides"><ChallengeSide round={challengeEvidence.creator} /><ChallengeSide round={challengeEvidence.opponent} /></div>{canAccept && (ownEnrollment ? <button className="primary" onClick={() => void acceptChallenge()} disabled={actionState === "working"}>Accept with verified wallet</button> : <p>Join the public league below, then accept this invitation.</p>)}{canCancel && <button className="secondary" onClick={() => void cancelChallenge()} disabled={actionState === "working"}>Cancel challenge</button>}</>}
        </article>
      )}

      <div className="league-grid">
        <div className="league-table">
          <div className="league-table-heading"><h3>Verified leaderboard</h3><span>10+ settled calls</span></div>
          {state === "loading" && <div className="league-row muted"><span><i className="spinner" />Verifying every player…</span></div>}
          {state === "error" && <div className="league-row error-text"><span>{error}</span></div>}
          {state === "ready" && board.ranked.length === 0 && <div className="league-row muted"><span>No player has ten verified calls yet.</span></div>}
          {board.ranked.map((entry, index) => <LeagueRow key={entry.enrollment.id} entry={entry} rank={index + 1} />)}
          {board.provisional.length > 0 && <><div className="league-divider">Provisional</div>{board.provisional.map((entry) => <LeagueRow key={entry.enrollment.id} entry={entry} />)}</>}
          {failedProfiles > 0 && <p className="league-warning">{failedProfiles} {failedProfiles === 1 ? "profile was" : "profiles were"} excluded because live evidence could not be verified.</p>}
        </div>

        <aside className="league-actions" id="league-identity">
          <h3>{ownEnrollment ? "Your league identity" : "Join the league"}</h3>
          <p>{ownEnrollment ? `${nameOf(ownEnrollment)} · ${shortAddress(ownEnrollment.walletAddress)}` : "Sign one login message. It cannot trade or move funds."}</p>
          {!ownEnrollment && <p>Joining makes your wallet, enrollment time, optional name, and challenges public.</p>}
          <label><span>Optional display name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={24} placeholder={ownEnrollment?.displayName ?? "Wallet address by default"} /></label>
          <button className="secondary" onClick={() => void joinLeague()} disabled={actionState === "working"}>{ownEnrollment ? "Update name" : connected ? "Sign in and join" : "Connect wallet"}</button>
          <hr />
          <h3>Challenge a friend</h3>
          <p>Send the link to any wallet. They join, then each person places their own real trade.</p>
          <label><span>Friend’s wallet</span><input value={invitee} onChange={(event) => setInvitee(event.target.value)} placeholder="0x…" /></label>
          {!round && <p className="challenge-unavailable" role="status">Waiting for an eligible live DreamDEX round. Challenges cannot be created without a real market.</p>}
          <button className="secondary" onClick={() => void createChallenge()} disabled={actionState === "working"} aria-disabled={!round || undefined}>{round ? "Copy challenge link" : "No live round to challenge"}</button>
          {challengeLink && <label><span>Shareable challenge link</span><input readOnly value={challengeLink} onFocus={(event) => event.currentTarget.select()} /></label>}
          {latestSettled && <button className="secondary" onClick={() => void copyReceipt(latestSettled)}>Copy latest result</button>}
          {receiptLink && <label><span>Shareable result link</span><input readOnly value={receiptLink} onFocus={(event) => event.currentTarget.select()} /></label>}
          {actionMessage && <p aria-live="polite" className={actionState === "error" ? "action-message error-text" : "action-message"}>{actionMessage}</p>}
        </aside>
      </div>
    </section>
  );
}

function SharedReceiptCard({
  wallet,
  state,
  round,
  error,
}: {
  wallet: Address;
  state: SharedLoadState;
  round?: ProfileRound;
  error?: string;
}) {
  const points = round?.roundPoints ? formatRational(round.roundPoints, 2) : null;
  const confidence = round
    ? formatRational({
        numerator: round.confidence.numerator * 100n,
        denominator: round.confidence.denominator,
      }, 2)
    : null;
  const oneCallScore = round?.roundPoints
    ? formatRational({
        numerator: 100n * round.roundPoints.denominator + round.roundPoints.numerator,
        denominator: 2n * round.roundPoints.denominator,
      }, 2)
    : null;
  return (
    <article className="share-card receipt-card">
      <p className="eyebrow">Shared result receipt</p>
      {state === "loading" && <span aria-live="polite">Rebuilding this claim from DreamDEX…</span>}
      {state === "not-found" && <span role="status">No verified result was found for this wallet and Event Contract.</span>}
      {state === "error" && <span role="alert">{error ?? "This result could not be verified."}</span>}
      {state === "ready" && round && <>
        <h3>{shortAddress(wallet)} called {callLabel(round.question, round.side)}</h3>
        <strong className={`share-result ${round.state}`}>{round.state}</strong>
        <p>{round.question}</p>
        <p className="receipt-market-id"><span>Event Contract</span><code>{round.marketId}</code></p>
        <div className="receipt-proof-grid">
          <div><span>Entry confidence</span><strong>{confidence}%</strong></div>
          <div><span>Result</span><strong>{round.state}</strong></div>
          <div><span>Round points</span><strong>{points ?? "Not scored"}</strong></div>
          <div><span>Provisional skill score</span><strong>{oneCallScore ?? "Not scored"}</strong></div>
        </div>
        {round.roundPoints && <p className="receipt-formula">Result value is 1 for a correct call and 0 for an incorrect call. Round points = 100 × (result value − entry confidence). For one settled call, skill score = 50 + round points ÷ 2.</p>}
        <div className="proof-links">
          <a href={explorerTransaction(round.fillTransactionHash)} target="_blank" rel="noreferrer">Verify fill ↗</a>
          {round.settlementTransactionHash
            ? <a href={explorerTransaction(round.settlementTransactionHash)} target="_blank" rel="noreferrer">Verify finalization ↗</a>
            : <span>Finalization verified on-chain; indexed transaction link unavailable.</span>}
          {round.oracleTransactionHash && <a href={explorerTransaction(round.oracleTransactionHash)} target="_blank" rel="noreferrer">Verify oracle ↗</a>}
        </div>
      </>}
    </article>
  );
}

function LeagueRow({ entry, rank }: { entry: VerifiedLeagueProfile; rank?: number }) {
  const profile = entry.evidence.profile;
  return (
    <div className="league-row">
      <b>{rank ? `#${rank}` : "—"}</b>
      <span><strong>{nameOf(entry.enrollment)}</strong><small>{shortAddress(entry.enrollment.walletAddress)}</small></span>
      <span><strong>{profile.skillScore ? formatRational(profile.skillScore) : "—"}</strong><small>{profile.settledCount} settled</small></span>
    </div>
  );
}

function ChallengeSide({ round }: { round: ProfileRound | null }) {
  return (
    <div>
      <strong>{resultLabel(round)}</strong>
      {round && <a href={explorerTransaction(round.fillTransactionHash)} target="_blank" rel="noreferrer">Verify fill ↗</a>}
      {round?.settlementTransactionHash && <a href={explorerTransaction(round.settlementTransactionHash)} target="_blank" rel="noreferrer">Verify result ↗</a>}
    </div>
  );
}

function ChallengeLifecycleNotice({
  lifecycle,
  result,
  creator,
  opponent,
}: {
  lifecycle: ReturnType<typeof deriveChallengeLifecycle>;
  result?: ReturnType<typeof completedChallengeResult>;
  creator: Address;
  opponent: Address;
}) {
  const message = lifecycle === "completed"
    ? result === "creator"
      ? `Completed · ${shortAddress(creator)} made the stronger call.`
      : result === "opponent"
        ? `Completed · ${shortAddress(opponent)} made the stronger call.`
        : result === "draw"
          ? "Completed · both calls earned the same score."
          : "Completed · the settled comparison is void or unscored."
    : lifecycle === "expired"
      ? "Challenge expired · the invitation was not accepted while its Event Contract was tradable."
      : lifecycle === "locked-incomplete"
        ? "Market closed · the accepted challenge cannot receive another call. Existing evidence remains visible."
        : lifecycle === "awaiting-settlement"
          ? "Both calls are locked · waiting for DreamDEX settlement."
          : lifecycle === "cancelled"
            ? "Challenge cancelled · no further action is available."
            : lifecycle === "accepted"
              ? "Challenge accepted · both players must make their own DreamDEX call before the market locks."
              : "Challenge open · the invited wallet may accept while this exact market remains live.";
  return <p className={`challenge-lifecycle ${lifecycle}`} role="status">{message}</p>;
}
