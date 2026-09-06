import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createWalletClient, custom, type Address, type EIP1193Provider, type Hex } from "viem";
import type { VerifiedExecution } from "../core/execution.js";
import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import { readPublicConfig } from "./config.js";
import { readSocialConfig } from "../social/config.js";
import { formatUnits, parseDecimalUnits } from "./amounts.js";
import { ProfilePanel, type ProfileLoadState } from "./ProfilePanel.js";
import { cadenceLabel, outcomeLabels } from "./marketLabels.js";
import {
  MarketDiscoveryTimeoutError,
  withMarketDiscoveryDeadline,
} from "./marketDiscovery.js";
import { isUserRejectedRequest, publicErrorMessage, transactionFailureMessage } from "./errors.js";
import { buildCallQuote, selectedOutcomePrice } from "./quote.js";
import type { BrowserDreamDexRuntime, LiveRound, OrderPlan } from "./runtime.js";
import type {
  ConnectedWallet,
  LeagueEnrollmentSnapshot,
  LeagueEnrollmentStatus,
} from "./SocialPanel.js";

type LoadState = "loading" | "ready" | "empty" | "stale" | "error";
type TxState = "idle" | "preparing" | "review" | "approval-requested" | "approval-submitted" | "approval-confirmed" | "order-requested" | "submitted" | "filled" | "unfilled" | "rejected" | "failed";

const SocialPanel = lazy(() => import("./SocialPanel.js").then((module) => ({
  default: module.SocialPanel,
})));

function errorMessage(error: unknown) {
  return publicErrorMessage(error, "Something went wrong. Try again.");
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet";
}

function explorerTransaction(hash?: Hex) {
  return hash ? `${somniaShannon.blockExplorers.default.url}/tx/${hash}` : undefined;
}

function countdown(expirySec: bigint, nowMs: number) {
  const remaining = Number(expirySec) - Math.floor(nowMs / 1_000);
  if (remaining <= 0) return "Locked";
  const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
  const seconds = (remaining % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function hasBuyLiquidity(round: LiveRound): boolean {
  return round.book.yesAsks.length > 0 || round.book.noAsks.length > 0;
}

interface WalletConnectionInput {
  currentAddress?: Address;
  currentChainId?: number;
  connect: () => Promise<{ accounts: readonly Address[]; chainId: number }>;
  getProvider: (chainId: number | undefined) => Promise<EIP1193Provider | undefined>;
}

export async function resolveConnectedWallet({
  currentAddress,
  currentChainId,
  connect,
  getProvider,
}: WalletConnectionInput): Promise<ConnectedWallet> {
  let connectedAddress = currentAddress;
  let connectedChainId = currentChainId;
  if (!connectedAddress) {
    const connection = await connect();
    connectedAddress = connection.accounts[0];
    connectedChainId = connection.chainId;
  }
  const provider = await getProvider(connectedChainId);
  if (!connectedAddress || !provider) {
    throw new Error("Wallet connection did not return a signer.");
  }
  return {
    address: connectedAddress,
    walletClient: createWalletClient({
      account: connectedAddress,
      transport: custom(provider),
    }),
  };
}

export function App() {
  const configResult = useMemo(() => {
    try {
      const config = readPublicConfig(import.meta.env);
      return { config, error: null };
    } catch (error) {
      return { config: null, error: errorMessage(error) };
    }
  }, []);
  const socialConfigResult = useMemo(() => {
    try {
      return { config: readSocialConfig(import.meta.env), error: null };
    } catch (error) {
      return { config: null, error: errorMessage(error) };
    }
  }, []);
  const { address, chainId, connector: activeConnector, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const [rounds, setRounds] = useState<LiveRound[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<Hex>();
  const [marketNotice, setMarketNotice] = useState<string>();
  const [runtime, setRuntime] = useState<BrowserDreamDexRuntime>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string>();
  const [selected, setSelected] = useState<"UP" | "DOWN">("UP");
  const [stake, setStake] = useState("1");
  const [plan, setPlan] = useState<OrderPlan>();
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [approvalHash, setApprovalHash] = useState<Hex>();
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [execution, setExecution] = useState<VerifiedExecution>();
  const [txError, setTxError] = useState<string>();
  const [profileState, setProfileState] = useState<ProfileLoadState>("idle");
  const [profileResult, setProfileResult] = useState<ReconciledProfile>();
  const [profileError, setProfileError] = useState<string>();
  const [leagueEnrollment, setLeagueEnrollment] = useState<LeagueEnrollmentSnapshot>({
    status: "unavailable",
  });
  const [now, setNow] = useState(Date.now());
  const [runtimeGeneration, setRuntimeGeneration] = useState(0);
  const roundRequestId = useRef(0);
  const closedRuntimes = useRef(new WeakSet<BrowserDreamDexRuntime>());
  const selectedMarketIdRef = useRef<Hex | undefined>(undefined);

  const closeRuntimeOnce = useCallback((instance: BrowserDreamDexRuntime) => {
    if (closedRuntimes.current.has(instance)) return;
    closedRuntimes.current.add(instance);
    try {
      void Promise.resolve(instance.close()).catch(() => undefined);
    } catch {
      // The runtime is already retired; a synchronous close failure must not block recovery.
    }
  }, []);

  useEffect(() => {
    selectedMarketIdRef.current = selectedMarketId;
  }, [selectedMarketId]);

  const round = useMemo(() => rounds.find((item) =>
    item.market.marketId.toLowerCase() === selectedMarketId?.toLowerCase(),
  ) ?? rounds[0], [rounds, selectedMarketId]);

  const loadMarkets = useCallback(async (silent = false) => {
    if (!runtime) {
      if (!configResult.config) {
        setLoadState("error");
        setLoadError(configResult.error ?? "Application configuration is unavailable.");
      }
      return;
    }
    if (!configResult.config) {
      setLoadState("error");
      setLoadError(configResult.error ?? "Application configuration is unavailable.");
      return;
    }
    const requestId = ++roundRequestId.current;
    if (!silent) {
      setLoadState("loading");
      setLoadError(undefined);
    }
    const activeRuntime = runtime;
    try {
      const next = await withMarketDiscoveryDeadline(activeRuntime.loadMarkets());
      if (requestId !== roundRequestId.current) return;
      setRounds(next.rounds);
      setSelectedMarketId((current) => next.rounds.some((item) =>
        item.market.marketId.toLowerCase() === current?.toLowerCase(),
      ) ? current : next.rounds[0]?.market.marketId);
      setMarketNotice(next.rejectedCount > 0 || next.truncated
        ? `${next.rejectedCount} candidate${next.rejectedCount === 1 ? " was" : "s were"} excluded because live evidence was incomplete.${next.truncated ? " The bounded market list has more results." : ""}`
        : undefined);
      const selectedRound = next.rounds.find((item) =>
        item.market.marketId.toLowerCase() === selectedMarketIdRef.current?.toLowerCase(),
      ) ?? next.rounds[0];
      setLoadState(selectedRound && hasBuyLiquidity(selectedRound) ? "ready" : "empty");
    } catch (error) {
      if (requestId !== roundRequestId.current) return;
      if (error instanceof MarketDiscoveryTimeoutError) {
        closeRuntimeOnce(activeRuntime);
        setRuntime((current) => current === activeRuntime ? undefined : current);
      } else if (silent) {
        return;
      }
      const message = errorMessage(error);
      setRounds([]);
      setSelectedMarketId(undefined);
      setMarketNotice(undefined);
      setLoadError(message);
      setLoadState(message.includes("headroom") || message.includes("Trading") ? "stale" : "error");
    }
  }, [closeRuntimeOnce, configResult, runtime]);

  const retryMarkets = useCallback(() => {
    if (runtime) {
      void loadMarkets();
      return;
    }
    setLoadState("loading");
    setLoadError(undefined);
    setRuntimeGeneration((current) => current + 1);
  }, [loadMarkets, runtime]);

  const loadProfile = useCallback(async () => {
    if (!runtime || !address || !walletClient) return;
    setProfileState("loading");
    setProfileError(undefined);
    try {
      setProfileResult(await runtime.loadProfile(address, walletClient));
      setProfileState("ready");
    } catch (error) {
      setProfileError(errorMessage(error));
      setProfileState("error");
    }
  }, [address, runtime, walletClient]);

  useEffect(() => {
    if (!configResult.config) {
      setLoadState("error");
      setLoadError(configResult.error ?? "Application configuration is unavailable.");
      return;
    }
    let active = true;
    let instance: BrowserDreamDexRuntime | undefined;
    void import("./runtime.js").then(({ BrowserDreamDexRuntime }) => {
      if (!active) return;
      instance = new BrowserDreamDexRuntime(configResult.config!);
      setRuntime(instance);
    }).catch((error) => {
      setLoadState("error");
      setLoadError(errorMessage(error));
    });
    return () => {
      active = false;
      roundRequestId.current += 1;
      if (instance) closeRuntimeOnce(instance);
    };
  }, [closeRuntimeOnce, configResult, runtimeGeneration]);

  useEffect(() => {
    if (runtime) void loadMarkets();
  }, [loadMarkets, runtime]);

  useEffect(() => {
    if (isConnected && runtime && address && walletClient) void loadProfile();
    else {
      setProfileState("idle");
      setProfileResult(undefined);
      setProfileError(undefined);
    }
  }, [address, isConnected, loadProfile, runtime, walletClient]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const transactionInFlight = ["preparing", "review", "approval-requested", "approval-submitted", "approval-confirmed", "order-requested", "submitted"].includes(txState);
  const automaticRefreshBlocked = transactionInFlight || txState === "filled";
  const leagueEnrollmentStatus: LeagueEnrollmentStatus = !socialConfigResult.config
    ? "unavailable"
    : !isConnected || !address
      ? "disconnected"
      : leagueEnrollment.address?.toLowerCase() === address.toLowerCase()
        ? leagueEnrollment.status
        : "checking";
  const requiresLeagueEnrollment = leagueEnrollmentStatus === "not-enrolled";
  const checkingLeagueEnrollment = leagueEnrollmentStatus === "checking";

  useEffect(() => {
    if (!runtime || automaticRefreshBlocked) return;
    const timer = window.setInterval(() => void loadMarkets(true), 30_000);
    return () => window.clearInterval(timer);
  }, [automaticRefreshBlocked, loadMarkets, runtime]);

  useEffect(() => {
    if (
      !round
      || automaticRefreshBlocked
      || (loadState !== "ready" && loadState !== "empty")
      || now < Number(round.market.expirySec) * 1_000
    ) return;
    void loadMarkets();
  }, [automaticRefreshBlocked, loadMarkets, loadState, now, round]);

  useEffect(() => {
    if (!plan || txState !== "review") return;
    if (
      address?.toLowerCase() !== plan.account.toLowerCase()
      || chainId !== somniaShannon.id
    ) {
      setPlan(undefined);
      setTxError("The wallet or network changed. Review the call again.");
      setTxState("failed");
    }
  }, [address, chainId, plan, txState]);

  const side = selected === "UP" ? "BUY_YES" : "BUY_NO";
  const asks = selected === "UP" ? round?.book.yesAsks : round?.book.noAsks;
  const bestAsk = asks?.[0]?.price;
  const quoteResult = useMemo(() => {
    if (!round) return { quote: null, error: undefined };
    if (bestAsk === undefined) {
      return { quote: null, error: `No ${selected} contracts are available to buy right now.` };
    }
    try {
      return { quote: buildCallQuote({
        stake: parseDecimalUnits(stake, round.market.indexed.quoteDecimals),
        side,
        book: round.book,
        constraints: round.market.constraints,
      }), error: undefined };
    } catch (error) {
      return { quote: null, error: errorMessage(error) };
    }
  }, [bestAsk, round, selected, side, stake]);
  const quote = quoteResult.quote;

  function selectMarket(marketId: Hex) {
    if (transactionInFlight) return;
    const next = rounds.find((item) => item.market.marketId.toLowerCase() === marketId.toLowerCase());
    if (!next) return;
    setSelectedMarketId(marketId);
    setPlan(undefined);
    setExecution(undefined);
    setTxHash(undefined);
    setApprovalHash(undefined);
    setApprovalConfirmed(false);
    setTxError(undefined);
    setTxState("idle");
    setLoadState(hasBuyLiquidity(next) ? "ready" : "empty");
  }

  async function reviewCall() {
    if (!round || !quote) return;
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) {
        setTxError("No injected wallet is available in this browser.");
        setTxState("failed");
        return;
      }
      await connectWallet();
      return;
    }
    if (requiresLeagueEnrollment) {
      focusLeagueEnrollment();
      return;
    }
    if (checkingLeagueEnrollment) return;
    setTxState("preparing");
    setTxError(undefined);
    setTxHash(undefined);
    setApprovalHash(undefined);
    setApprovalConfirmed(false);
    try {
      if (chainId !== somniaShannon.id) {
        await switchChainAsync({ chainId: somniaShannon.id });
        throw new Error("Somnia Testnet is ready. Review the call again before signing.");
      }
      if (!walletClient) throw new Error("Wallet is still connecting. Try again.");
      const liveRound = await runtime!.refreshRound(round.market.marketId);
      const liveQuote = buildCallQuote({
        stake: parseDecimalUnits(stake, liveRound.market.indexed.quoteDecimals),
        side,
        book: liveRound.book,
        constraints: liveRound.market.constraints,
      });
      setRounds((current) => current.map((item) =>
        item.market.marketId.toLowerCase() === liveRound.market.marketId.toLowerCase()
          ? liveRound : item,
      ));
      const nextPlan = await runtime!.prepareOrder({
        walletClient,
        market: liveRound.market,
        side,
        yesPrice: liveQuote.yesPrice,
        quantity: liveQuote.quantity,
      });
      setPlan(nextPlan);
      setTxState("review");
    } catch (error) {
      const message = errorMessage(error);
      setTxError(message);
      setTxState("failed");
      if (/no longer tradable|unavailable|locked/i.test(message)) await loadMarkets();
    }
  }

  async function confirmCall() {
    if (!plan || !walletClient) return;
    const progress = {
      approvalRequired: Boolean(plan.approval),
      approvalSubmitted: false,
      approvalConfirmed: false,
      orderSubmitted: false,
      approvalDescription: `${formatUnits(plan.maximumCost, plan.market.indexed.quoteDecimals)} ${collateralLabel}`,
    };
    setTxState(plan.approval ? "approval-requested" : "order-requested");
    setTxError(undefined);
    setTxHash(undefined);
    setApprovalHash(undefined);
    setApprovalConfirmed(false);
    try {
      const result = await runtime!.sendPlan(walletClient, plan, {
        onApprovalSubmitted: (hash) => {
          progress.approvalSubmitted = true;
          setApprovalHash(hash);
          setTxState("approval-submitted");
        },
        onApprovalConfirmed: (hash) => {
          progress.approvalConfirmed = true;
          setApprovalHash(hash);
          setApprovalConfirmed(true);
          setTxState("approval-confirmed");
        },
        onOrderRequested: () => setTxState("order-requested"),
        onOrderSubmitted: (hash) => {
          progress.orderSubmitted = true;
          setTxHash(hash);
          setTxState("submitted");
        },
      });
      setExecution(result);
      setTxState("filled");
    } catch (error) {
      const safeSourceMessage = publicErrorMessage(error, "");
      const message = transactionFailureMessage(error, progress);
      setTxError(message);
      if (safeSourceMessage.includes("live price moved")) await loadMarkets();
      if (safeSourceMessage.includes("did not fill")) setTxState("unfilled");
      else if (isUserRejectedRequest(error)) setTxState("rejected");
      else setTxState("failed");
    }
  }

  const decimals = round?.market.indexed.quoteDecimals ?? 6;
  const probability = bestAsk === undefined || !round
    ? "—"
    : `${formatUnits(bestAsk * 100n, decimals, 0)}%`;
  const labels = outcomeLabels(round?.market.indexed.question ?? "");
  const collateralLabel = round?.collateralSymbol ?? "Collateral";

  async function connectWallet(): Promise<ConnectedWallet | null> {
    const connector = activeConnector ?? connectors[0];
    if (!connector) {
      setTxError("No injected wallet is available in this browser.");
      setTxState("failed");
      return null;
    }
    try {
      return await resolveConnectedWallet({
        currentAddress: isConnected ? address : undefined,
        currentChainId: isConnected ? chainId : undefined,
        connect: () => connectAsync({ connector }),
        getProvider: async (providerChainId) => {
          const provider = await connector.getProvider(
            providerChainId === undefined ? undefined : { chainId: providerChainId },
          );
          return provider as EIP1193Provider | undefined;
        },
      });
    } catch (error) {
      setTxError(errorMessage(error));
      setTxState("rejected");
      return null;
    }
  }

  function focusLeagueEnrollment() {
    const enrollment = document.getElementById("league-identity");
    enrollment?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    enrollment?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#arena">Skip to live arena</a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="Call Your Shot home">
            <img className="brand-mark" src="/favicon.svg" alt="" width="40" height="40" />
            <span className="brand-copy"><strong>Call Your Shot</strong><small>Prediction skill league</small></span>
          </a>
          <nav className="primary-nav" aria-label="Primary navigation">
            <a href="#arena">Make a call</a>
            <a href="#record">Your record</a>
            <a href="#league">League</a>
          </nav>
          <div className="header-actions">
            <span className="network-badge"><i />Somnia testnet</span>
            <button className="wallet-button" onClick={() => isConnected ? disconnect() : void connectWallet()} disabled={isConnecting}>
              <span className={isConnected ? "status-dot connected" : "status-dot"} />
              {isConnecting ? "Connecting…" : shortAddress(address)}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span className="live-dot" />The on-chain prediction league</p>
            <h1>Call the outcome.<br /><em>Let the chain keep score.</em></h1>
            <p>Choose a live DreamDEX event, set the most you can lose, and build a public record from real fills—not screenshots or self-reported wins.</p>
            <div className="hero-actions">
              <a className="primary-link" href="#arena">Enter the live arena <span aria-hidden="true">↘</span></a>
              <a className="text-link" href="#record">See how proof works</a>
            </div>
            <ul className="trust-list" aria-label="Product guarantees">
              <li><span>✓</span> Real fills only</li>
              <li><span>✓</span> Non-custodial</li>
              <li><span>✓</span> Spend cannot buy rank</li>
            </ul>
          </div>
          <aside className="hero-proof" aria-label="How a prediction becomes verified">
            <div className="proof-header"><span>Proof pipeline</span><b>LIVE</b></div>
            <div className="proof-step"><b>01</b><div><strong>You make the call</strong><span>Choose YES or NO and cap your risk.</span></div></div>
            <div className="proof-line" />
            <div className="proof-step"><b>02</b><div><strong>DreamDEX fills it</strong><span>The trade—not a button click—creates the receipt.</span></div></div>
            <div className="proof-line" />
            <div className="proof-step"><b>03</b><div><strong>Somnia settles it</strong><span>Your result and skill score become independently checkable.</span></div></div>
            <div className="proof-footer"><span className="proof-seal">✓</span><span><strong>Proof over promises</strong><small>Every counted call links back to chain evidence.</small></span></div>
          </aside>
        </section>

        <section className="arena-section" id="arena" aria-labelledby="arena-title">
          <div className="section-intro">
            <span className="section-index">01</span>
            <div><p className="eyebrow">Live arena</p><h2 id="arena-title">Make one call that can be proven.</h2><p>Pick an active event, choose a side, and know your maximum loss before your wallet opens.</p></div>
          </div>

          {loadState === "loading" && <section className="state-card loading-state" aria-live="polite"><span className="scanner"><i /></span><div><strong>Finding live Event Contracts…</strong><span>Checking the indexer, on-chain bindings, and real order books.</span></div></section>}
          {(loadState === "error" || loadState === "stale") && (
            <section className="state-card error" role="alert">
              <span className="state-icon" aria-hidden="true">!</span>
              <div><strong>{loadState === "stale" ? "This market just locked" : "Live markets unavailable"}</strong><span>{loadError}</span></div>
              <button onClick={retryMarkets}>Refresh markets</button>
            </section>
          )}
          {rounds.length > 0 && loadState !== "loading" && (
            <section className="market-lobby" aria-labelledby="market-lobby-title">
              <div className="market-lobby-heading">
                <div><span className="micro-label">Choose an event</span><h3 id="market-lobby-title">Live now</h3></div>
                <button className="secondary compact" onClick={() => void loadMarkets()} disabled={automaticRefreshBlocked}>Refresh markets</button>
              </div>
              <div className="market-list">
                {rounds.map((item) => {
                  const selectedMarket = item.market.marketId.toLowerCase() === round?.market.marketId.toLowerCase();
                  const liquid = hasBuyLiquidity(item);
                  return <button
                    key={item.market.marketId}
                    type="button"
                    className={selectedMarket ? "market-option selected" : "market-option"}
                    aria-pressed={selectedMarket}
                    onClick={() => selectMarket(item.market.marketId)}
                    disabled={transactionInFlight}
                  >
                    <span className="market-option-top"><b>{item.market.indexed.asset || "Event"}</b><small>{cadenceLabel(item.market.indexed.intervalSec)}</small></span>
                    <strong>{item.market.indexed.question}</strong>
                    <span className="market-option-bottom"><small className={liquid ? "market-live" : ""}>{liquid ? `${countdown(item.market.expirySec, now)} left` : "No sell orders"}</small><i aria-hidden="true">→</i></span>
                  </button>;
                })}
              </div>
              {marketNotice && <p className="market-notice">{marketNotice}</p>}
            </section>
          )}
          {loadState === "empty" && (
            <section className="state-card" role="status">
              <span className="state-icon quiet" aria-hidden="true">○</span>
              <div><strong>No trade is available right now</strong><span>The selected market has no sell orders for either side. Choose another event or refresh; nothing has been estimated or fabricated.</span></div>
              <button onClick={() => void loadMarkets()}>Refresh live books</button>
            </section>
          )}

          {round && (loadState === "ready" || loadState === "empty") && (
            <section className="round-card">
              <div className="round-meta">
                <div><span>Selected event</span><strong>{round.market.indexed.asset || "Event"} · {cadenceLabel(round.market.indexed.intervalSec)}</strong></div>
                <div><span>Market closes in</span><strong className="timer">{countdown(round.market.expirySec, now)}</strong></div>
              </div>
              <div className="round-workspace">
                <div className="outcome-panel">
                  <div className="reference">
                    <span>Event question</span>
                    <strong>{round.market.indexed.question}</strong>
                    <small>Your first filled YES or NO order becomes your public call.</small>
                  </div>

                  <fieldset className="direction-picker" disabled={loadState !== "ready" || txState === "filled"}>
                    <legend>Which outcome are you calling?</legend>
                    <button type="button" aria-pressed={selected === "UP"} className={selected === "UP" ? "direction up selected" : "direction up"} onClick={() => { setSelected("UP"); setTxState("idle"); }}>
                      <span className="arrow">↗</span><span><strong>{labels.up}</strong><small>{labels.upDetail}</small></span>
                      <b>{selected === "UP" ? probability : round.book.yesAsks[0] ? `${formatUnits(round.book.yesAsks[0].price * 100n, decimals, 0)}%` : "—"}</b>
                    </button>
                    <button type="button" aria-pressed={selected === "DOWN"} className={selected === "DOWN" ? "direction down selected" : "direction down"} onClick={() => { setSelected("DOWN"); setTxState("idle"); }}>
                      <span className="arrow">↘</span><span><strong>{labels.down}</strong><small>{labels.downDetail}</small></span>
                      <b>{selected === "DOWN" ? probability : round.book.noAsks[0] ? `${formatUnits(round.book.noAsks[0].price * 100n, decimals, 0)}%` : "—"}</b>
                    </button>
                  </fieldset>
                </div>

                <div className="ticket-panel">
                  <div className="ticket-heading"><span>02</span><div><small>Build your ticket</small><strong>Set the risk. Review the proof.</strong></div></div>
                  <label className="stake-field">
                    <span>Your maximum loss</span>
                    <div><input inputMode="decimal" value={stake} onChange={(event) => { setStake(event.target.value); setTxState("idle"); }} aria-describedby={quoteResult.error ? "stake-help quote-error" : "stake-help"} aria-invalid={Boolean(quoteResult.error)} /><b>{collateralLabel}</b></div>
                    <small id="stake-help">This is the most the call can cost—not a suggested spend.</small>
                    {quoteResult.error && <small id="quote-error" className="quote-error" role="status">{quoteResult.error}</small>}
                  </label>

                  <div className="receipt-preview">
                    <div><span>Market price</span><strong>{probability}</strong></div>
                    <div><span>Maximum loss</span><strong>{quote ? `${formatUnits(quote.maximumCost, decimals)} ${collateralLabel}` : "—"}</strong></div>
                    <div><span>Possible payout</span><strong>{quote ? `${formatUnits(quote.possiblePayout, decimals)} ${collateralLabel}` : "—"}</strong></div>
                  </div>

                  {isConnected && socialConfigResult.config && (
                    <div className={`league-call-gate ${leagueEnrollmentStatus}`} role="status">
                      <span aria-hidden="true">{leagueEnrollmentStatus === "enrolled" ? "✓" : leagueEnrollmentStatus === "not-enrolled" ? "!" : "·"}</span>
                      <div>
                        <strong>{leagueEnrollmentStatus === "enrolled"
                          ? "League entry active"
                          : leagueEnrollmentStatus === "not-enrolled"
                            ? "Join before making this call"
                            : leagueEnrollmentStatus === "checking"
                              ? "Checking league enrollment…"
                              : "League status unavailable"}</strong>
                        <small>{leagueEnrollmentStatus === "enrolled"
                          ? "A verified fill can count toward your public competition record."
                          : leagueEnrollmentStatus === "not-enrolled"
                            ? "Calls made before enrollment stay verifiable, but cannot rank."
                            : leagueEnrollmentStatus === "checking"
                              ? "Trading will unlock as soon as your status is confirmed."
                              : "This call remains verifiable, but ranking cannot be confirmed right now."}</small>
                      </div>
                    </div>
                  )}

                  {isConnected && !socialConfigResult.config && (
                    <div className="league-call-gate unavailable" role="status">
                      <span aria-hidden="true">·</span>
                      <div><strong>Standalone verification</strong><small>The social league is unavailable. This call can still appear in your DreamDEX-backed personal record.</small></div>
                    </div>
                  )}

                  {txState === "review" && plan ? (
                    <div className="review-panel" role="group" aria-labelledby="review-title">
                      <p className="eyebrow">Review before signing</p>
                      <h2 id="review-title">{plan.side === "BUY_YES" ? labels.up : labels.down} with a maximum loss of {formatUnits(plan.maximumCost, decimals)} {collateralLabel}</h2>
                      <p>{plan.approval ? "Your wallet will request a bounded token approval, then the trade." : "Your wallet will request the trade."} The call counts only after a real fill is verified. Price protection: {formatUnits(plan.selectedLimitPrice * 100n, decimals, 1)}% maximum.</p>
                      <div className="review-actions"><button className="secondary" onClick={() => setTxState("idle")}>Go back</button><button className="primary" onClick={() => void confirmCall()}>Confirm in wallet</button></div>
                    </div>
                  ) : (
                    <button className="primary call-button" onClick={() => requiresLeagueEnrollment ? focusLeagueEnrollment() : void reviewCall()} disabled={checkingLeagueEnrollment || (!requiresLeagueEnrollment && (!quote || loadState !== "ready" || ["preparing", "approval-requested", "approval-submitted", "approval-confirmed", "order-requested", "submitted", "filled"].includes(txState)))}>
                      {!isConnected
                        ? "Connect wallet to call it"
                        : requiresLeagueEnrollment
                          ? "Join league before calling"
                          : checkingLeagueEnrollment
                            ? "Checking league entry…"
                            : txState === "preparing"
                              ? "Checking live market…"
                              : txState === "filled"
                                ? "Call verified"
                                : `Review ${selected} call`}
                    </button>
                  )}

                  {txState === "approval-requested" && <p className="tx-status" aria-live="polite"><span className="spinner" />Confirm the bounded {collateralLabel} approval in your wallet. Nothing has been submitted yet.</p>}
                  {txState === "approval-submitted" && <p className="tx-status" aria-live="polite"><span className="spinner" />Approval submitted. Waiting for confirmation… <a href={explorerTransaction(approvalHash)} target="_blank" rel="noreferrer">View approval ↗</a></p>}
                  {txState === "approval-confirmed" && <p className="tx-status" aria-live="polite"><span className="spinner" />Bounded approval confirmed. Checking the live DreamDEX order… <a href={explorerTransaction(approvalHash)} target="_blank" rel="noreferrer">View approval ↗</a></p>}
                  {txState === "order-requested" && <p className="tx-status" aria-live="polite"><span className="spinner" />{approvalConfirmed ? "Approval confirmed. Now confirm the DreamDEX order in your wallet." : "Confirm the DreamDEX order in your wallet. Nothing has been submitted yet."}</p>}
                  {txState === "submitted" && <p className="tx-status" aria-live="polite"><span className="spinner" />Submitted to Somnia. Waiting for a verified fill… <code>{shortAddress(txHash)}</code></p>}
                  {txState === "filled" && execution && plan && <div className="verified-receipt" role="status"><span>✓</span><div><strong>Your {plan.side === "BUY_YES" ? labels.up : labels.down} call is verified</strong><small>{formatUnits(execution.totalQuantity, decimals)} contracts filled at an average {formatUnits(selectedOutcomePrice(plan.side, execution.averageFillPrice, plan.market.constraints.priceScale) * 100n, decimals, 0)}% price.</small><code>{shortAddress(execution.transactionHash)}</code></div></div>}
                  {(["unfilled", "rejected", "failed"] as TxState[]).includes(txState) && <div className="tx-error" role="alert"><strong>{txState === "unfilled" ? "Order mined, but not filled" : txState === "rejected" ? approvalConfirmed ? "Order cancelled" : plan?.approval ? "Approval cancelled" : "Order cancelled" : txHash ? "Verification interrupted" : "Call not placed"}</strong><span>{txError}</span>{(approvalHash || txHash) && <div className="tx-proof-links">{approvalHash && <a href={explorerTransaction(approvalHash)} target="_blank" rel="noreferrer">View approval transaction ↗</a>}{txHash && <a href={explorerTransaction(txHash)} target="_blank" rel="noreferrer">View order transaction ↗</a>}</div>}<button onClick={() => setTxState("idle")}>{txHash ? "Return to live market" : "Try again safely"}</button></div>}
                </div>
              </div>
            </section>
          )}
        </section>

        <section className="proof-system" aria-labelledby="proof-system-title">
          <div><p className="eyebrow">What gets counted</p><h2 id="proof-system-title">A scoreboard that cannot be bought.</h2></div>
          <div className="proof-system-grid">
            <article><span>01</span><strong>One market, one call</strong><p>Your first verified buy locks the prediction. Editing the story later is impossible.</p></article>
            <article><span>02</span><strong>Outcome from settlement</strong><p>Results come from the finalized Event Contract—not from our database.</p></article>
            <article><span>03</span><strong>Every call weighs the same</strong><p>Better decisions improve rank. A larger wallet does not.</p></article>
          </div>
        </section>

        <ProfilePanel
          connected={isConnected}
          state={profileState}
          result={profileResult}
          error={profileError}
          onRefresh={() => void loadProfile()}
        />

        <Suspense fallback={<section className="social-section" id="league"><div className="profile-empty"><span><i className="spinner" />Loading the skill league…</span></div></section>}>
          <SocialPanel
            config={socialConfigResult.config}
            configError={socialConfigResult.error}
            runtime={runtime}
            round={round}
            connected={isConnected}
            address={address}
            walletClient={walletClient}
            onConnect={connectWallet}
            onEnrollmentChange={setLeagueEnrollment}
          />
        </Suspense>

      </main>
      <footer><div><img src="/favicon.svg" alt="" width="28" height="28" /><strong>Call Your Shot</strong></div><span>Powered by DreamDEX Event Contracts on Somnia</span><span>Testnet product · Not financial advice</span></footer>
    </div>
  );
}
