import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { VerifiedExecution } from "../core/execution.js";
import type { LiveRound } from "./runtime.js";

interface MarketVerificationTrailProps {
  round: LiveRound;
  execution?: VerifiedExecution;
}

function explorerAddress(address: string): string {
  return `${somniaShannon.blockExplorers.default.url}/address/${address}`;
}

function explorerTransaction(hash: string): string {
  return `${somniaShannon.blockExplorers.default.url}/tx/${hash}`;
}

export function MarketVerificationTrail({ round, execution }: MarketVerificationTrailProps) {
  const { market, book } = round;
  return (
    <details className="market-verification">
      <summary>
        <span><i aria-hidden="true">✓</i><strong>DreamDEX verification trail</strong></span>
        <small>Open technical proof</small>
      </summary>
      <ol>
        <li>
          <span>01</span>
          <div>
            <strong>Trusted origin matched</strong>
            <p>The indexed Event Contract matches operator {market.indexed.operatorId} and venue:</p>
            <code>{market.indexed.venueId}</code>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Indexer and chain bindings agree</strong>
            <p>Market address, live pool, collateral, decimals, and outcome-token IDs were checked against the contract.</p>
            <code>{market.marketId}</code>
            <div className="verification-links">
              <a href={explorerAddress(market.marketAddress)} target="_blank" rel="noreferrer">Market contract ↗</a>
              <a href={explorerAddress(market.pool)} target="_blank" rel="noreferrer">Active pool ↗</a>
              <a href={explorerAddress(market.collateral)} target="_blank" rel="noreferrer">Collateral ↗</a>
            </div>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Live order book checked</strong>
            <p>{book.yesAsks.length} YES and {book.noAsks.length} NO sell levels are currently available. Orders must satisfy the contract’s tick, lot, and minimum-quantity rules.</p>
            <code>tick {market.constraints.tickSize.toString()} · lot {market.constraints.lotSize.toString()} · minimum {market.constraints.minQuantity.toString()}</code>
          </div>
        </li>
        <li className={execution ? "verified-stage" : "pending-stage"}>
          <span>{execution ? "✓" : "04"}</span>
          <div>
            <strong>{execution ? "Real fill event decoded" : "Waiting for a real fill"}</strong>
            {execution
              ? <><p>{execution.fills.length} {execution.fills.length === 1 ? "fill event was" : "fill events were"} decoded for {execution.totalQuantity.toString()} raw contract units.</p><a href={explorerTransaction(execution.transactionHash)} target="_blank" rel="noreferrer">Verify fill transaction ↗</a></>
              : <p>A wallet request or mined transaction is not counted. This stage turns green only after DreamDEX returns an actual fill.</p>}
          </div>
        </li>
      </ol>
    </details>
  );
}
