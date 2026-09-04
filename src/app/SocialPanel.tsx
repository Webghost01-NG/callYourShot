import { useCallback, useEffect, useMemo, useState } from "react";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { Address, Hex, WalletClient } from "viem";
import { formatRational, type ProfileRound } from "../core/profile.js";
import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import { buildLeagueBoard, type LeagueBoard, type VerifiedLeagueProfile } from "../social/leaderboard.js";
import type { SocialConfig } from "../social/config.js";
import type { Challenge, LeagueProfile } from "../social/model.js";
import { SupabaseSocialRepository } from "../social/repository.js";
import { challengeUrl, readSocialRoute, receiptUrl } from "../social/share.js";
import type { BrowserDreamDexRuntime, LiveRound } from "./runtime.js";
import { callLabel } from "./marketLabels.js";

type SocialLoadState = "idle" | "loading" | "ready" | "error";
type SharedLoadState = "idle" | "loading" | "ready" | "not-found" | "error";

interface SocialPanelProps {
  config: SocialConfig | null;
  configError: string | null;
  runtime?: BrowserDreamDexRuntime;
  round?: LiveRound;
  connected: boolean;
  address?: Address;
  walletClient?: WalletClient;
  onConnect: () => Promise<ConnectedWallet | null>;
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
}: SocialPanelProps) {
  const repository = useMemo(() => config ? new SupabaseSocialRepository(config) : null, [config]);
  const route = useMemo(() => readSocialRoute(window.location.search), []);
  const [state, setState] = useState<SocialLoadState>(config ? "loading" : "idle");
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
    setError(undefined);
    try {
      const profiles = await repository.listProfiles();
      const result = await reconcileEnrollments(runtime, profiles);
      setEnrollments(profiles);
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
    if (!repository || !runtime) return;
    if (state === "error") {
      if (route.kind === "challenge") {
        setChallengeError("Challenge verification is unavailable because the public league could not be loaded.");
        setChallengeState("error");
      }
      if (route.kind === "receipt") {
        setReceiptError("Result verification is unavailable because the public league could not be loaded.");
        setReceiptState("error");
      }
      return;
    }
    if (state !== "ready") return;
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
    if (route.kind === "receipt") {
      setReceiptRound(undefined);
      setReceiptError(undefined);
      setReceiptState("loading");
      const enrollment = enrollmentByWallet.get(route.wallet.toLowerCase());
      if (!enrollment) {
        setReceiptState("not-found");
      } else {
        void runtime.loadPublicProfile(route.wallet, enrollmentStart(enrollment))
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
      }
    }
    return () => { active = false; };
  }, [enrollmentByWallet, repository, route, runtime, state]);

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
    if (!repository || route.kind !== "challenge") return;
    setActionState("working");
    setActionMessage(undefined);
    try {
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

  if (!config) {
    return (
      <section className="social-section" aria-labelledby="league-title">
        <div className="section-heading"><div><p className="eyebrow">Skill league</p><h2 id="league-title">Compete on proof, not bankroll.</h2></div></div>
        <div className="profile-empty"><strong>Social league is not configured</strong><span>{configError ?? "Add the public Supabase URL and publishable key to enable real enrollments. No sample players are shown."}</span></div>
      </section>
    );
  }

  const latestSettled = ownEvidence?.evidence.profile.rounds.find((item) => item.state === "won" || item.state === "lost");
  const challenge = challengeEvidence?.challenge;
  const canAccept = challenge?.status === "open" && address?.toLowerCase() === challenge.invitedWallet.toLowerCase();
  const canCancel = challenge?.status === "open" && address?.toLowerCase() === challenge.creatorWallet.toLowerCase();

  return (
    <section className="social-section" aria-labelledby="league-title">
      <div className="section-heading">
        <div><p className="eyebrow">Skill league</p><h2 id="league-title">Compete on proof, not bankroll.</h2><p>Scores are rebuilt from real DreamDEX fills after enrollment. Spending more never improves rank.</p></div>
        <button className="secondary refresh-profile" onClick={() => void loadBoard()} disabled={state === "loading"}>Refresh board</button>
      </div>

      {route.kind === "receipt" && (
        <article className="share-card">
          <p className="eyebrow">Shared result receipt</p>
          {receiptState === "loading" && <span aria-live="polite">Rebuilding this claim from DreamDEX…</span>}
          {receiptState === "not-found" && <span role="status">No verified result was found for this wallet and Event Contract.</span>}
          {receiptState === "error" && <span role="alert">{receiptError ?? "This result could not be verified."}</span>}
          {receiptState === "ready" && receiptRound && <><h3>{shortAddress(route.wallet)} called {callLabel(receiptRound.question, receiptRound.side)}</h3><strong className={`share-result ${receiptRound.state}`}>{receiptRound.state}</strong><p>{receiptRound.question}</p><div className="proof-links"><a href={explorerTransaction(receiptRound.fillTransactionHash)} target="_blank" rel="noreferrer">Verify fill ↗</a>{receiptRound.settlementTransactionHash && <a href={explorerTransaction(receiptRound.settlementTransactionHash)} target="_blank" rel="noreferrer">Verify result ↗</a>}</div></>}
        </article>
      )}

      {route.kind === "challenge" && (
        <article className="share-card">
          <p className="eyebrow">Friend challenge</p>
          {challengeState === "loading" && <span aria-live="polite">Rebuilding both records from DreamDEX…</span>}
          {challengeState === "not-found" && <span role="status">This challenge was not found or is no longer available.</span>}
          {challengeState === "error" && <span role="alert">{challengeError ?? "This challenge could not be verified."}</span>}
          {challengeState === "ready" && challenge && challengeEvidence && <><h3>{shortAddress(challenge.creatorWallet)} vs {shortAddress(challenge.invitedWallet)}</h3><p>Status: {challenge.status}. This app compares independent trades in one market and never escrows funds.</p><div className="challenge-sides"><ChallengeSide round={challengeEvidence.creator} /><ChallengeSide round={challengeEvidence.opponent} /></div>{canAccept && (ownEnrollment ? <button className="primary" onClick={() => void acceptChallenge()} disabled={actionState === "working"}>Accept with verified wallet</button> : <p>Join the public league below, then accept this invitation.</p>)}{canCancel && <button className="secondary" onClick={() => void cancelChallenge()} disabled={actionState === "working"}>Cancel challenge</button>}</>}
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

        <aside className="league-actions">
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
