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
import { buildCallQuote, selectedOutcomePrice } from "./quote.js";
import type { BrowserDreamDexRuntime, LiveRound, OrderPlan } from "./runtime.js";
import type { ConnectedWallet } from "./SocialPanel.js";

type LoadState = "loading" | "ready" | "empty" | "stale" | "error";
type TxState = "idle" | "preparing" | "review" | "authorizing" | "submitted" | "filled" | "unfilled" | "rejected" | "failed";

const SocialPanel = lazy(() => import("./SocialPanel.js").then((module) => ({
  default: module.SocialPanel,
})));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet";
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
  const [execution, setExecution] = useState<VerifiedExecution>();
  const [txError, setTxError] = useState<string>();
  const [profileState, setProfileState] = useState<ProfileLoadState>("idle");
  const [profileResult, setProfileResult] = useState<ReconciledProfile>();
  const [profileError, setProfileError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const roundRequestId = useRef(0);
  const selectedMarketIdRef = useRef<Hex | undefined>(undefined);

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
    try {
      const next = await runtime.loadMarkets();
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
      if (requestId !== roundRequestId.current || silent) return;
      const message = errorMessage(error);
      setRounds([]);
      setSelectedMarketId(undefined);
      setMarketNotice(undefined);
      setLoadError(message);
      setLoadState(message.includes("headroom") || message.includes("Trading") ? "stale" : "error");
    }
  }, [configResult, runtime]);

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
      if (instance) void instance.close();
    };
  }, [configResult]);

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

  const transactionInFlight = ["preparing", "review", "authorizing", "submitted"].includes(txState);
  const automaticRefreshBlocked = transactionInFlight || txState === "filled";

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
    setTxState("preparing");
    setTxError(undefined);
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
    setTxState("authorizing");
    setTxError(undefined);
    try {
      const result = await runtime!.sendPlan(walletClient, plan, (hash) => {
        setTxHash(hash);
        setTxState("submitted");
      });
      setExecution(result);
      setTxState("filled");
    } catch (error) {
      const message = errorMessage(error);
      setTxError(message);
      if (message.includes("live price moved")) await loadMarkets();
      if (message.includes("did not fill")) setTxState("unfilled");
      else if (message.toLowerCase().includes("rejected") || message.includes("denied")) setTxState("rejected");
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Call Your Shot home">
          <span className="brand-mark">C</span><span>Call Your Shot</span>
        </a>
        <button className="wallet-button" onClick={() => isConnected ? disconnect() : void connectWallet()} disabled={isConnecting}>
          <span className={isConnected ? "status-dot connected" : "status-dot"} />
          {isConnecting ? "Connecting…" : shortAddress(address)}
        </button>
      </header>

      <main>
        <section className="hero-copy">
          <p className="eyebrow">Live Event Contracts</p>
          <h1>Pick a market. Call it. Prove it.</h1>
          <p>Choose a real DreamDEX event. Your first verified fill becomes your public prediction for that market.</p>
        </section>

        {loadState === "loading" && <section className="state-card" aria-live="polite"><span className="spinner" />Finding live Event Contracts…</section>}
        {(loadState === "error" || loadState === "stale") && (
          <section className="state-card error" role="alert">
            <strong>{loadState === "stale" ? "This market just locked" : "Live markets unavailable"}</strong>
            <span>{loadError}</span>
            <button onClick={() => void loadMarkets()}>Refresh markets</button>
          </section>
        )}
        {rounds.length > 0 && loadState !== "loading" && (
          <section className="market-lobby" aria-labelledby="market-lobby-title">
            <div className="market-lobby-heading">
              <div><p className="eyebrow">Market lobby</p><h2 id="market-lobby-title">What do you want to call?</h2></div>
              <button className="secondary" onClick={() => void loadMarkets()} disabled={automaticRefreshBlocked}>Refresh markets</button>
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
                  <span><b>{item.market.indexed.asset || "Event"}</b><small>{cadenceLabel(item.market.indexed.intervalSec)}</small></span>
                  <strong>{item.market.indexed.question}</strong>
                  <small>{liquid ? `${countdown(item.market.expirySec, now)} left` : "No sell orders"}</small>
                </button>;
              })}
            </div>
            {marketNotice && <p className="market-notice">{marketNotice}</p>}
          </section>
        )}
        {loadState === "empty" && (
          <section className="state-card" role="status">
            <strong>No trade is available right now</strong>
            <span>The selected market has no sell orders for either side. Choose another event or refresh; nothing has been estimated or fabricated.</span>
            <button onClick={() => void loadMarkets()}>Refresh live books</button>
          </section>
        )}

        {round && (loadState === "ready" || loadState === "empty") && (
          <section className="round-card">
            <div className="round-meta">
              <div><span>Selected market</span><strong>{round.market.indexed.asset || "Event"} · {cadenceLabel(round.market.indexed.intervalSec)}</strong></div>
              <div><span>Time left</span><strong className="timer">{countdown(round.market.expirySec, now)}</strong></div>
            </div>
            <div className="reference">
              <span>Event question</span>
              <strong>{round.market.indexed.question}</strong>
              <small>Choose YES or NO before the market locks.</small>
            </div>

            <fieldset className="direction-picker" disabled={loadState !== "ready" || txState === "filled"}>
              <legend>What’s your call?</legend>
              <button type="button" aria-pressed={selected === "UP"} className={selected === "UP" ? "direction up selected" : "direction up"} onClick={() => { setSelected("UP"); setTxState("idle"); }}>
                <span className="arrow">↗</span><span><strong>{labels.up}</strong><small>{labels.upDetail}</small></span>
                <b>{selected === "UP" ? probability : round.book.yesAsks[0] ? `${formatUnits(round.book.yesAsks[0].price * 100n, decimals, 0)}%` : "—"}</b>
              </button>
              <button type="button" aria-pressed={selected === "DOWN"} className={selected === "DOWN" ? "direction down selected" : "direction down"} onClick={() => { setSelected("DOWN"); setTxState("idle"); }}>
                <span className="arrow">↘</span><span><strong>{labels.down}</strong><small>{labels.downDetail}</small></span>
                <b>{selected === "DOWN" ? probability : round.book.noAsks[0] ? `${formatUnits(round.book.noAsks[0].price * 100n, decimals, 0)}%` : "—"}</b>
              </button>
            </fieldset>

            <label className="stake-field">
              <span>Your maximum loss</span>
              <div><input inputMode="decimal" value={stake} onChange={(event) => { setStake(event.target.value); setTxState("idle"); }} aria-describedby={quoteResult.error ? "stake-help quote-error" : "stake-help"} aria-invalid={Boolean(quoteResult.error)} /><b>{collateralLabel}</b></div>
              <small id="stake-help">You cannot lose more than this amount.</small>
              {quoteResult.error && <small id="quote-error" className="quote-error" role="status">{quoteResult.error}</small>}
            </label>

            <div className="receipt-preview">
              <div><span>Current market price</span><strong>{probability}</strong></div>
              <div><span>Maximum loss</span><strong>{quote ? `${formatUnits(quote.maximumCost, decimals)} ${collateralLabel}` : "—"}</strong></div>
              <div><span>Possible payout</span><strong>{quote ? `${formatUnits(quote.possiblePayout, decimals)} ${collateralLabel}` : "—"}</strong></div>
            </div>

            {txState === "review" && plan ? (
              <div className="review-panel" role="group" aria-labelledby="review-title">
                <p className="eyebrow">Review before signing</p>
                <h2 id="review-title">{plan.side === "BUY_YES" ? labels.up : labels.down} with a maximum loss of {formatUnits(plan.maximumCost, decimals)} {collateralLabel}</h2>
                <p>{plan.approval ? "Your wallet will request a bounded token approval, then the trade." : "Your wallet will request the trade."} The call counts only after a real fill is verified. Price protection: {formatUnits(plan.selectedLimitPrice * 100n, decimals, 1)}% maximum.</p>
                <div className="review-actions"><button className="secondary" onClick={() => setTxState("idle")}>Go back</button><button className="primary" onClick={() => void confirmCall()}>Confirm in wallet</button></div>
              </div>
            ) : (
              <button className="primary call-button" onClick={() => void reviewCall()} disabled={!quote || loadState !== "ready" || ["preparing", "authorizing", "submitted", "filled"].includes(txState)}>
                {!isConnected ? "Connect wallet to call it" : txState === "preparing" ? "Checking live market…" : txState === "filled" ? "Call verified" : `Review ${selected} call`}
              </button>
            )}

            {txState === "authorizing" && <p className="tx-status" aria-live="polite"><span className="spinner" />Approve the request in your wallet. Nothing is submitted yet.</p>}
            {txState === "submitted" && <p className="tx-status" aria-live="polite"><span className="spinner" />Submitted to Somnia. Waiting for a verified fill… <code>{shortAddress(txHash)}</code></p>}
            {txState === "filled" && execution && plan && <div className="verified-receipt" role="status"><span>✓</span><div><strong>Your {plan.side === "BUY_YES" ? labels.up : labels.down} call is verified</strong><small>{formatUnits(execution.totalQuantity, decimals)} contracts filled at an average {formatUnits(selectedOutcomePrice(plan.side, execution.averageFillPrice, plan.market.constraints.priceScale) * 100n, decimals, 0)}% price.</small><code>{shortAddress(execution.transactionHash)}</code></div></div>}
            {(["unfilled", "rejected", "failed"] as TxState[]).includes(txState) && <div className="tx-error" role="alert"><strong>{txState === "unfilled" ? "Order mined, but not filled" : txState === "rejected" ? "Request rejected" : "Call not placed"}</strong><span>{txError}</span><button onClick={() => setTxState("idle")}>Try again safely</button></div>}
          </section>
        )}

        <ProfilePanel
          connected={isConnected}
          state={profileState}
          result={profileResult}
          error={profileError}
          onRefresh={() => void loadProfile()}
        />

        <Suspense fallback={<section className="social-section"><div className="profile-empty"><span><i className="spinner" />Loading the skill league…</span></div></section>}>
          <SocialPanel
            config={socialConfigResult.config}
            configError={socialConfigResult.error}
            runtime={runtime}
            round={round}
            connected={isConnected}
            address={address}
            walletClient={walletClient}
            onConnect={connectWallet}
          />
        </Suspense>

        <section className="how-it-works"><p className="eyebrow">Simple on top. Verifiable underneath.</p><div><article><b>01</b><strong>Pick a side</strong><span>YES or NO. No charts required.</span></article><article><b>02</b><strong>Set your limit</strong><span>Your maximum loss is clear before signing.</span></article><article><b>03</b><strong>Prove your instinct</strong><span>Only a real DreamDEX fill becomes a call.</span></article></div></section>
      </main>
      <footer><span>Powered by DreamDEX Event Contracts on Somnia</span><span>Not financial advice · Testnet</span></footer>
    </div>
  );
}
