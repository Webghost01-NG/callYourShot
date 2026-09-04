import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { Hex } from "viem";
import { formatRational, type Rational } from "../core/profile.js";
import type { ReconciledProfile } from "../dreamdex/reconciliation.js";
import { formatUnits } from "./amounts.js";

export type ProfileLoadState = "idle" | "loading" | "ready" | "error";

interface ProfilePanelProps {
  connected: boolean;
  state: ProfileLoadState;
  result?: ReconciledProfile;
  error?: string;
  onRefresh: () => void;
}

function percentage(value: Rational): string {
  return `${formatRational({ numerator: value.numerator * 100n, denominator: value.denominator }, 0)}%`;
}

function signedAmount(value: bigint, decimals: number): string {
  const sign = value > 0n ? "+" : value < 0n ? "−" : "";
  return `${sign}${formatUnits(value < 0n ? -value : value, decimals)} collateral`;
}

function explorerTransaction(hash: Hex): string {
  return `${somniaShannon.blockExplorers.default.url}/tx/${hash}`;
}

function dateTime(timestampSec: bigint): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(timestampSec) * 1_000));
}

export function ProfilePanel({ connected, state, result, error, onRefresh }: ProfilePanelProps) {
  const profile = result?.profile;
  const decimals = profile?.collateralDecimals ?? 6;
  const status = profile?.state === "verified"
    ? "Verified"
    : profile?.state === "provisional"
      ? `Provisional · ${10 - profile.settledCount} more to rank`
      : "No settled calls yet";

  return (
    <section className="profile-section" aria-labelledby="profile-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your public track record</p>
          <h2 id="profile-title">Skill, backed by receipts.</h2>
          <p>Every result below comes from your first real buy in a BTC round and its finalized outcome.</p>
        </div>
        {connected && <button className="secondary refresh-profile" onClick={onRefresh} disabled={state === "loading"}>Refresh record</button>}
      </div>

      {!connected && (
        <div className="profile-empty">
          <strong>Connect your wallet to see your record</strong>
          <span>Nothing is uploaded or self-reported. The app rebuilds it from DreamDEX evidence.</span>
        </div>
      )}
      {connected && state === "loading" && <div className="profile-empty" aria-live="polite"><span><i className="spinner" />Rebuilding your record from DreamDEX…</span></div>}
      {connected && state === "error" && (
        <div className="profile-empty profile-error" role="alert">
          <strong>Record verification is unavailable</strong>
          <span>{error}</span>
          <button onClick={onRefresh}>Try again</button>
        </div>
      )}

      {connected && state === "ready" && profile && (
        <>
          <div className="profile-card">
            <div className="profile-score">
              <span>Skill score</span>
              <strong>{profile.skillScore ? formatRational(profile.skillScore) : "—"}</strong>
              <b className={`profile-badge ${profile.state}`}>{status}</b>
            </div>
            <div className="profile-metrics">
              <div><span>Accuracy</span><strong>{profile.accuracy ? percentage(profile.accuracy) : "—"}</strong></div>
              <div><span>Settled calls</span><strong>{profile.settledCount}</strong></div>
              <div><span>Best streak</span><strong>{profile.bestStreak}</strong></div>
              <div><span>Actual return</span><strong>{signedAmount(profile.totalReturnRaw, decimals)}</strong></div>
              <div><span>Max drawdown</span><strong>{signedAmount(-profile.maximumDrawdownRaw, decimals)}</strong></div>
              <div><span>Formula</span><strong>{profile.formulaVersion}</strong></div>
            </div>
          </div>

          {result.evidenceGaps.length > 0 && (
            <div className="evidence-warning" role="status">
              <strong>Some proof is incomplete</strong>
              <span>{result.evidenceGaps.length} evidence {result.evidenceGaps.length === 1 ? "item is" : "items are"} unavailable. Affected calls are excluded when fill or settlement truth cannot be verified; missing explorer links are labeled honestly.</span>
              <details><summary>See verification details</summary><ul>{result.evidenceGaps.map((gap, index) => <li key={`${gap.marketId}-${gap.kind}-${index}`}>{gap.message}</li>)}</ul></details>
            </div>
          )}

          <div className="profile-history">
            <h3>Call history</h3>
            {profile.rounds.length === 0 ? (
              <div className="profile-empty"><span>No qualifying BTC calls were found for this wallet.</span></div>
            ) : profile.rounds.map((round) => (
              <article className="history-row" key={round.marketId}>
                <div className={`history-direction ${round.side.toLowerCase()}`}>{round.side === "UP" ? "↗" : "↘"}</div>
                <div className="history-main">
                  <div><strong>{round.side} call</strong><span>{dateTime(round.timestampSec)}</span></div>
                  <p>{round.question}</p>
                  <div className="proof-links">
                    <a href={explorerTransaction(round.fillTransactionHash)} target="_blank" rel="noreferrer">Fill receipt ↗</a>
                    {round.settlementTransactionHash
                      ? <a href={explorerTransaction(round.settlementTransactionHash)} target="_blank" rel="noreferrer">Final result ↗</a>
                      : round.state !== "pending" && <span>Final-result link unavailable</span>}
                    {round.oracleTransactionHash
                      ? <a href={explorerTransaction(round.oracleTransactionHash)} target="_blank" rel="noreferrer">Oracle answer ↗</a>
                      : round.state !== "pending" && <span>Oracle link unavailable</span>}
                  </div>
                </div>
                <div className={`history-result ${round.state}`}>
                  <span>{round.state === "won" ? "Won" : round.state === "lost" ? "Lost" : round.state === "void" ? "Void" : "Pending"}</span>
                  <strong>{round.roundPoints ? `${round.roundPoints.numerator >= 0n ? "+" : ""}${formatRational(round.roundPoints)} pts` : "Not scored"}</strong>
                  <small>{percentage(round.confidence)} entry confidence</small>
                </div>
              </article>
            ))}
          </div>

          <details className="formula-note">
            <summary>How is skill calculated?</summary>
            <p>Correct calls earn more when your entry price showed they were unlikely. Wrong calls lose more when your entry price showed high confidence. Every settled call has equal weight, so spending more cannot improve your rank. Voids do not count.</p>
          </details>
        </>
      )}
    </section>
  );
}
