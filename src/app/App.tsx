import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { Hex } from "viem";
import type { VerifiedExecution } from "../core/execution.js";
import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import { readPublicConfig } from "./config.js";
import { formatUnits, parseDecimalUnits } from "./amounts.js";
import { ProfilePanel, type ProfileLoadState } from "./ProfilePanel.js";
import { buildCallQuote } from "./quote.js";
import type { BrowserDreamDexRuntime, LiveRound, OrderPlan } from "./runtime.js";

type LoadState = "loading" | "ready" | "empty" | "stale" | "error";
type TxState = "idle" | "preparing" | "review" | "authorizing" | "submitted" | "filled" | "unfilled" | "rejected" | "failed";

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

export function App() {
  const configResult = useMemo(() => {
    try {
      const config = readPublicConfig(import.meta.env);
      return { config, error: null };
    } catch (error) {
      return { config: null, error: errorMessage(error) };
    }
  }, []);
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const [round, setRound] = useState<LiveRound>();
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

  const loadRound = useCallback(async () => {
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
    setLoadState("loading");
    setLoadError(undefined);
    try {
      const next = await runtime.loadRound();
      const hasLiquidity = next.book.yesAsks.length > 0 || next.book.noAsks.length > 0;
      setRound(next);
      setLoadState(hasLiquidity ? "ready" : "empty");
    } catch (error) {
      const message = errorMessage(error);
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
      if (instance) void instance.close();
    };
  }, [configResult]);

  useEffect(() => {
    if (runtime) void loadRound();
  }, [loadRound, runtime]);

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

  const side = selected === "UP" ? "BUY_YES" : "BUY_NO";
  const asks = selected === "UP" ? round?.book.yesAsks : round?.book.noAsks;
  const bestAsk = asks?.[0]?.price;
  const quote = useMemo(() => {
    if (!round || bestAsk === undefined) return null;
    try {
      return buildCallQuote({
        stake: parseDecimalUnits(stake, round.market.indexed.quoteDecimals),
        bestAsk,
        constraints: round.market.constraints,
      });
    } catch {
      return null;
    }
  }, [bestAsk, round, stake]);

  async function reviewCall() {
    if (!round || bestAsk === undefined || !quote) return;
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
      if (chainId !== somniaShannon.id) await switchChainAsync({ chainId: somniaShannon.id });
      if (!walletClient) throw new Error("Wallet is still connecting. Try again.");
      const nextPlan = await runtime!.prepareOrder({
        walletClient,
        market: round.market,
        side,
        price: quote.limitPrice,
        quantity: quote.quantity,
      });
      setPlan(nextPlan);
      setTxState("review");
    } catch (error) {
      setTxError(errorMessage(error));
      setTxState("failed");
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
      if (message.includes("live price moved")) await loadRound();
      if (message.includes("did not fill")) setTxState("unfilled");
      else if (message.toLowerCase().includes("rejected") || message.includes("denied")) setTxState("rejected");
      else setTxState("failed");
    }
  }

  const decimals = round?.market.indexed.quoteDecimals ?? 6;
  const probability = bestAsk === undefined || !round
    ? "—"
    : `${formatUnits(bestAsk * 100n, decimals, 0)}%`;
  const openingReference = round?.market.indexed.question.match(/[\d,.]+/)?.[0];

  async function connectWallet() {
    const connector = connectors[0];
    if (!connector) {
      setTxError("No injected wallet is available in this browser.");
      setTxState("failed");
      return;
    }
    try {
      await connectAsync({ connector });
    } catch (error) {
      setTxError(errorMessage(error));
      setTxState("rejected");
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
          <p className="eyebrow">Live prediction round</p>
          <h1>Bitcoin: higher or lower?</h1>
          <p>Make one real call. Your first verified fill becomes your public prediction for this round.</p>
        </section>

        {loadState === "loading" && <section className="state-card" aria-live="polite"><span className="spinner" />Finding the live BTC round…</section>}
        {(loadState === "error" || loadState === "stale") && (
          <section className="state-card error" role="alert">
            <strong>{loadState === "stale" ? "This round just locked" : "Live market unavailable"}</strong>
            <span>{loadError}</span>
            <button onClick={() => void loadRound()}>Try the next round</button>
          </section>
        )}
        {loadState === "empty" && (
          <section className="state-card" role="status">
            <strong>No trade is available right now</strong>
            <span>The live round has no sell orders for either side. Nothing has been estimated or fabricated.</span>
            <button onClick={() => void loadRound()}>Refresh live book</button>
          </section>
        )}

        {round && (loadState === "ready" || loadState === "empty") && (
          <section className="round-card">
            <div className="round-meta">
              <div><span>Round</span><strong>BTC · 15 min</strong></div>
              <div><span>Time left</span><strong className="timer">{countdown(round.market.expirySec, now)}</strong></div>
            </div>
            <div className="reference">
              <span>Opening reference</span>
              <strong>{openingReference ? `$${openingReference}` : "Defined by the live market"}</strong>
              <small>{round.market.indexed.question}</small>
            </div>

            <fieldset className="direction-picker" disabled={loadState !== "ready" || txState === "filled"}>
              <legend>What’s your call?</legend>
              <button className={selected === "UP" ? "direction up selected" : "direction up"} onClick={() => { setSelected("UP"); setTxState("idle"); }}>
                <span className="arrow">↗</span><span><strong>Higher</strong><small>UP contracts</small></span>
                <b>{selected === "UP" ? probability : round.book.yesAsks[0] ? `${formatUnits(round.book.yesAsks[0].price * 100n, decimals, 0)}%` : "—"}</b>
              </button>
              <button className={selected === "DOWN" ? "direction down selected" : "direction down"} onClick={() => { setSelected("DOWN"); setTxState("idle"); }}>
                <span className="arrow">↘</span><span><strong>Lower</strong><small>DOWN contracts</small></span>
                <b>{selected === "DOWN" ? probability : round.book.noAsks[0] ? `${formatUnits(round.book.noAsks[0].price * 100n, decimals, 0)}%` : "—"}</b>
              </button>
            </fieldset>

            <label className="stake-field">
              <span>Your maximum loss</span>
              <div><input inputMode="decimal" value={stake} onChange={(event) => { setStake(event.target.value); setTxState("idle"); }} aria-describedby="stake-help" /><b>tUSDC</b></div>
              <small id="stake-help">You cannot lose more than this amount.</small>
            </label>

            <div className="receipt-preview">
              <div><span>Current market price</span><strong>{probability}</strong></div>
              <div><span>Maximum loss</span><strong>{quote ? `${formatUnits(quote.maximumCost, decimals)} tUSDC` : "—"}</strong></div>
              <div><span>Possible payout</span><strong>{quote ? `${formatUnits(quote.possiblePayout, decimals)} tUSDC` : "—"}</strong></div>
            </div>

            {txState === "review" && plan ? (
              <div className="review-panel" role="dialog" aria-label="Review your call">
                <p className="eyebrow">Review before signing</p>
                <h2>{selected === "UP" ? "Higher" : "Lower"} with a maximum loss of {formatUnits(plan.maximumCost, decimals)} tUSDC</h2>
                <p>{plan.approval ? "Your wallet will request a bounded token approval, then the trade." : "Your wallet will request the trade."} The call counts only after a real fill is verified. Price protection: {formatUnits(plan.price * 100n, decimals, 1)}% maximum.</p>
                <div className="review-actions"><button className="secondary" onClick={() => setTxState("idle")}>Go back</button><button className="primary" onClick={() => void confirmCall()}>Confirm in wallet</button></div>
              </div>
            ) : (
              <button className="primary call-button" onClick={() => void reviewCall()} disabled={!quote || loadState !== "ready" || ["preparing", "authorizing", "submitted", "filled"].includes(txState)}>
                {!isConnected ? "Connect wallet to call it" : txState === "preparing" ? "Checking live market…" : txState === "filled" ? "Call verified" : `Review ${selected} call`}
              </button>
            )}

            {txState === "authorizing" && <p className="tx-status" aria-live="polite"><span className="spinner" />Approve the request in your wallet. Nothing is submitted yet.</p>}
            {txState === "submitted" && <p className="tx-status" aria-live="polite"><span className="spinner" />Submitted to Somnia. Waiting for a verified fill… <code>{shortAddress(txHash)}</code></p>}
            {txState === "filled" && execution && <div className="verified-receipt" role="status"><span>✓</span><div><strong>Your {selected} call is verified</strong><small>{formatUnits(execution.totalQuantity, decimals)} contracts filled at an average {formatUnits(execution.averageFillPrice * 100n, decimals, 0)}% price.</small><code>{shortAddress(execution.transactionHash)}</code></div></div>}
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

        <section className="how-it-works"><p className="eyebrow">Simple on top. Verifiable underneath.</p><div><article><b>01</b><strong>Pick a side</strong><span>Higher or lower. No charts required.</span></article><article><b>02</b><strong>Set your limit</strong><span>Your maximum loss is clear before signing.</span></article><article><b>03</b><strong>Prove your instinct</strong><span>Only a real DreamDEX fill becomes a call.</span></article></div></section>
      </main>
      <footer><span>Powered by DreamDEX Event Contracts on Somnia</span><span>Not financial advice · Testnet</span></footer>
    </div>
  );
}
