import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ORDER_TYPE,
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
  isBinaryMarket,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isHash,
} from "viem";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.VALIDATION_PORT ?? "4173", 10);
const indexerUrl = process.env.DREAMDEX_INDEXER_URL
  ?? "https://dev.smk.somnia.host/v1/graphql";
const wsRpcUrl = process.env.SOMNIA_WS_RPC_URL
  ?? "wss://api.infra.testnet.somnia.network/ws";
const asset = process.env.VALIDATION_ASSET ?? "BTC";
const interval = process.env.VALIDATION_INTERVAL ?? "15m";
const minimumHeadroomSeconds = 180;
const testQuantity = 1_000_000n;
const root = fileURLToPath(new URL("../validation/", import.meta.url));
const preparedPlans = new Map();
const completeSetAmount = 1_000_000n;
const approveAbi = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
}];
const binaryPoolAbi = [{
  type: "function",
  name: "mintSet",
  stateMutability: "nonpayable",
  inputs: [
    { name: "yesTo", type: "address" },
    { name: "noTo", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [],
}];
const outcomeTokenAbi = [
  {
    type: "function",
    name: "isOperator",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];
const redeemAbi = [{
  type: "function",
  name: "redeem",
  stateMutability: "nonpayable",
  inputs: [
    { name: "operatorId", type: "uint32" },
    { name: "venueId", type: "bytes32" },
    { name: "marketId", type: "bytes32" },
    { name: "outcomeIdx", type: "uint8" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [],
}];

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("VALIDATION_PORT must be a valid TCP port.");
}

const exchange = new SomniaMarkets({
  indexerUrl,
  chain: somniaShannon,
  wsRpcUrl,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const publicClient = createPublicClient({
  chain: somniaShannon,
  transport: http("https://dream-rpc.somnia.network/"),
});

function serialize(value) {
  return JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(serialize(value));
}

async function prepareOrder(accountInput) {
  const account = getAddress(accountInput);
  const markets = Object.values(await exchange.loadMarkets(true));
  const now = Math.floor(Date.now() / 1_000);
  const candidates = markets
    .filter((market) =>
      isBinaryMarket(market.info)
      && market.active
      && market.info.asset === asset
      && market.info.mode === "reference"
      && market.info.interval === interval
      && Number(market.info.expiry) - now >= minimumHeadroomSeconds)
    .sort((left, right) =>
      Number(left.info.expiry) - Number(right.info.expiry));

  for (const market of candidates) {
    const onchain = await exchange.client.getMarketOnchain(market.info.marketId);
    if (onchain.status !== 1) continue;

    const yesSymbol = market.outcomes?.find((outcome) =>
      outcome.label === "YES")?.symbol;
    if (!yesSymbol) continue;

    const book = await exchange.fetchOrderBook(yesSymbol, 5);
    const bestAsk = book.info.yesAsks[0];
    if (!bestAsk) continue;

    const tickSize = 10n ** BigInt(
      market.info.quoteDecimals - market.precision.price,
    );
    const limitPrice = BigInt(bestAsk.price) + tickSize;
    if (limitPrice >= 1_000_000n) continue;
    const maximumCost = (limitPrice * testQuantity) / 1_000_000n;
    const currentAllowance = await exchange.client.getErc20Allowance(
      market.info.collateral,
      account,
      market.info.poolAddress,
    );
    const balancesBefore = {
      collateral: await exchange.client.getErc20Balance(
        market.info.collateral,
        account,
      ),
      yes: await exchange.client.getOutcomeBalance({
        outcomeToken: onchain.outcomeToken,
        account,
        id: BigInt(market.info.yesTokenId),
      }),
    };

    const trader = exchange.client.createTrader({
      account,
      // buildPlaceOrder never sends; this object supplies only signer identity.
      walletClient: { account },
    });
    const unsigned = await trader.buildPlaceOrder({
      pool: market.info.poolAddress,
      side: "BUY_YES",
      price: limitPrice,
      quantity: testQuantity,
      orderType: ORDER_TYPE.IOC,
    });

    const result = {
      chainId: somniaShannon.id,
      account,
      market: {
        marketId: market.info.marketId,
        symbol: market.symbol,
        question: market.info.question,
        expiry: Number(market.info.expiry),
        pool: market.info.poolAddress,
        collateral: market.info.collateral,
        yesTokenId: market.info.yesTokenId,
      },
      order: {
        side: "BUY_YES",
        timeInForce: "IOC",
        quantity: testQuantity,
        bestAsk: BigInt(bestAsk.price),
        limitPrice,
        maximumCost,
      },
      balancesBefore,
      transactions: [
        currentAllowance < maximumCost && unsigned.approval && {
          ...unsigned.approval,
          data: encodeFunctionData({
            abi: approveAbi,
            functionName: "approve",
            args: [market.info.poolAddress, maximumCost],
          }),
          description: `Approve at most ${maximumCost} raw tUSDC for the test order`,
        },
        unsigned.order,
        {
          to: market.info.collateral,
          data: encodeFunctionData({
            abi: approveAbi,
            functionName: "approve",
            args: [market.info.poolAddress, 0n],
          }),
          value: 0n,
          description: "Revoke the test pool's remaining tUSDC allowance",
        },
      ]
        .filter(Boolean)
        .map(({ to, data, value, description }) => ({
          from: account,
          to,
          data,
          value: `0x${value.toString(16)}`,
          description,
        })),
    };
    preparedPlans.set(account, {
      marketId: market.info.marketId,
      expiry: Number(market.info.expiry),
      collateral: market.info.collateral,
      outcomeToken: onchain.outcomeToken,
      yesTokenId: BigInt(market.info.yesTokenId),
    });
    return result;
  }

  throw new Error(
    `No liquid ${asset} ${interval} rolling market has at least `
      + `${minimumHeadroomSeconds} seconds remaining. Retry after the next roll.`,
  );
}

async function selectLiveMarket() {
  const markets = Object.values(await exchange.loadMarkets(true));
  const now = Math.floor(Date.now() / 1_000);
  const candidates = markets
    .filter((market) =>
      isBinaryMarket(market.info)
      && market.active
      && market.info.asset === asset
      && market.info.mode === "reference"
      && market.info.interval === interval
      && Number(market.info.expiry) - now >= minimumHeadroomSeconds)
    .sort((left, right) =>
      Number(left.info.expiry) - Number(right.info.expiry));
  for (const market of candidates) {
    const onchain = await exchange.client.getMarketOnchain(market.info.marketId);
    if (onchain.status === 1) return { market, onchain };
  }
  throw new Error(
    `No ${asset} ${interval} rolling market has at least `
      + `${minimumHeadroomSeconds} seconds remaining. Retry after the next roll.`,
  );
}

async function prepareCompleteSet(accountInput) {
  const account = getAddress(accountInput);
  const { market, onchain } = await selectLiveMarket();
  const allowance = await exchange.client.getErc20Allowance(
    market.info.collateral,
    account,
    market.info.poolAddress,
  );
  const transactions = [];
  if (allowance < completeSetAmount) {
    transactions.push({
      from: account,
      to: market.info.collateral,
      data: encodeFunctionData({
        abi: approveAbi,
        functionName: "approve",
        args: [market.info.poolAddress, completeSetAmount],
      }),
      value: "0x0",
      description: "Approve exactly 1 tUSDC for complete-set minting",
    });
  }
  transactions.push({
    from: account,
    to: market.info.poolAddress,
    data: encodeFunctionData({
      abi: binaryPoolAbi,
      functionName: "mintSet",
      args: [account, account, completeSetAmount],
    }),
    value: "0x0",
    description: "Mint one YES and one NO contract",
  });
  if (allowance >= completeSetAmount) {
    transactions.push({
      from: account,
      to: market.info.collateral,
      data: encodeFunctionData({
        abi: approveAbi,
        functionName: "approve",
        args: [market.info.poolAddress, 0n],
      }),
      value: "0x0",
      description: "Revoke the pool's remaining tUSDC allowance",
    });
  }
  return {
    chainId: somniaShannon.id,
    account,
    market: {
      marketId: market.info.marketId,
      symbol: market.symbol,
      question: market.info.question,
      expiry: Number(market.info.expiry),
      pool: market.info.poolAddress,
      collateral: market.info.collateral,
      outcomeToken: onchain.outcomeToken,
      yesTokenId: market.info.yesTokenId,
      noTokenId: market.info.noTokenId,
    },
    amount: completeSetAmount,
    transactions,
  };
}

async function prepareRedemption(accountInput, marketId) {
  const account = getAddress(accountInput);
  if (!/^0x[0-9a-fA-F]{64}$/.test(marketId)) {
    throw new Error("Invalid market ID.");
  }
  const onchain = await exchange.client.getMarketOnchain(marketId);
  if (!onchain.finalized || !onchain.isResolved) {
    throw new Error("This market has not finalized yet.");
  }
  const winner = onchain.winningOutcome;
  if (winner !== 0 && winner !== 1) {
    throw new Error("The finalized market has no redeemable winning outcome.");
  }
  const winningId = winner === 0 ? onchain.yesId : onchain.noId;
  const balance = await exchange.client.getOutcomeBalance({
    outcomeToken: onchain.outcomeToken,
    account,
    id: winningId,
  });
  if (balance < completeSetAmount) {
    throw new Error("The wallet does not hold one winning contract for this market.");
  }
  const module = SOMNIA_TESTNET_ADDRESSES.binaryModule;
  const isOperator = await publicClient.readContract({
    address: onchain.outcomeToken,
    abi: outcomeTokenAbi,
    functionName: "isOperator",
    args: [account, module],
  });
  const transactions = [];
  if (!isOperator) {
    transactions.push({
      from: account,
      to: onchain.outcomeToken,
      data: encodeFunctionData({
        abi: outcomeTokenAbi,
        functionName: "setOperator",
        args: [module, true],
      }),
      value: "0x0",
      description: "Allow the DreamDEX module to redeem the winning contract",
    });
  }
  transactions.push({
    from: account,
    to: module,
    data: encodeFunctionData({
      abi: redeemAbi,
      functionName: "redeem",
      args: [0, `0x${"0".repeat(64)}`, marketId, winner, completeSetAmount],
    }),
    value: "0x0",
    description: `Redeem one ${winner === 0 ? "YES" : "NO"} contract`,
  });
  transactions.push({
    from: account,
    to: onchain.outcomeToken,
    data: encodeFunctionData({
      abi: outcomeTokenAbi,
      functionName: "setOperator",
      args: [module, false],
    }),
    value: "0x0",
    description: "Revoke the DreamDEX module's outcome-token permission",
  });
  return {
    account,
    marketId,
    winner: winner === 0 ? "YES" : "NO",
    winningBalance: balance,
    collateral: onchain.collateral,
    transactions,
  };
}

async function checkPreparedOrder(accountInput) {
  const account = getAddress(accountInput);
  const prepared = preparedPlans.get(account);
  if (!prepared) {
    throw new Error("No order was prepared for this wallet in this server session.");
  }
  const onchain = await exchange.client.getMarketOnchain(prepared.marketId);
  const headroomSeconds = prepared.expiry - Math.floor(Date.now() / 1_000);
  return {
    marketId: prepared.marketId,
    status: onchain.status,
    headroomSeconds,
    safeToSubmit: onchain.status === 1 && headroomSeconds >= 30,
  };
}

async function verifyPosition(accountInput) {
  const account = getAddress(accountInput);
  const prepared = preparedPlans.get(account);
  if (!prepared) {
    throw new Error("No order was prepared for this wallet in this server session.");
  }
  return {
    account,
    marketId: prepared.marketId,
    balancesAfter: {
      collateral: await exchange.client.getErc20Balance(
        prepared.collateral,
        account,
      ),
      yes: await exchange.client.getOutcomeBalance({
        outcomeToken: prepared.outcomeToken,
        account,
        id: prepared.yesTokenId,
      }),
    },
  };
}

async function getReceipt(hash) {
  if (!isHash(hash)) throw new Error("Invalid transaction hash.");
  const receipt = await publicClient.getTransactionReceipt({ hash });
  return {
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  };
}

async function serveFile(response, filename, contentType) {
  const body = await readFile(`${root}${filename}`);
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/") {
      await serveFile(response, "index.html", "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/app.js") {
      await serveFile(response, "app.js", "text/javascript; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/prepare") {
      const account = url.searchParams.get("account");
      if (!account) {
        sendJson(response, 400, { error: "Missing wallet account." });
        return;
      }
      sendJson(response, 200, await prepareOrder(account));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/prepare-set") {
      const account = url.searchParams.get("account");
      if (!account) {
        sendJson(response, 400, { error: "Missing wallet account." });
        return;
      }
      sendJson(response, 200, await prepareCompleteSet(account));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/prepare-redeem") {
      const account = url.searchParams.get("account");
      const marketId = url.searchParams.get("marketId");
      if (!account || !marketId) {
        sendJson(response, 400, { error: "Missing wallet account or market ID." });
        return;
      }
      sendJson(response, 200, await prepareRedemption(account, marketId));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/verify") {
      const account = url.searchParams.get("account");
      if (!account) {
        sendJson(response, 400, { error: "Missing wallet account." });
        return;
      }
      sendJson(response, 200, await verifyPosition(account));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/check") {
      const account = url.searchParams.get("account");
      if (!account) {
        sendJson(response, 400, { error: "Missing wallet account." });
        return;
      }
      sendJson(response, 200, await checkPreparedOrder(account));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/receipt") {
      const hash = url.searchParams.get("hash");
      if (!hash) {
        sendJson(response, 400, { error: "Missing transaction hash." });
        return;
      }
      sendJson(response, 200, await getReceipt(hash));
      return;
    }
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`DreamDEX validation: http://${host}:${port}`);
  console.log("This server prepares transactions; the connected wallet signs them.");
});
