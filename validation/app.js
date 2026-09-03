const prepareButton = document.querySelector("#prepare");
const executeButton = document.querySelector("#execute");
const output = document.querySelector("#output");
const mintSetButton = document.querySelector("#mint-set");
const redeemButton = document.querySelector("#redeem");
const shannonChainId = "0xc488";
let plan;

function show(value) {
  output.textContent = typeof value === "string"
    ? value
    : JSON.stringify(value, null, 2);
}

function formatRaw(value) {
  return (Number(value) / 1_000_000).toFixed(6);
}

async function waitForReceipt(hash) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/receipt?hash=${encodeURIComponent(hash)}`);
    if (response.ok) return response.json();
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for transaction ${hash}.`);
}

async function requireProvider() {
  if (!window.ethereum) {
    throw new Error("No injected wallet found. Open this page in a wallet-enabled browser.");
  }
  return window.ethereum;
}

async function switchToShannon(provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: shannonChainId }],
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: shannonChainId,
        chainName: "Somnia Shannon Testnet",
        nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
        rpcUrls: ["https://dream-rpc.somnia.network/"],
        blockExplorerUrls: ["https://shannon-explorer.somnia.network/"],
      }],
    });
  }
}

async function connectedWallet() {
  const provider = await requireProvider();
  await switchToShannon(provider);
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  return { provider, account };
}

async function executeTransactions(provider, transactions) {
  const hashes = [];
  for (const transaction of transactions) {
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      }],
    });
    show({ status: "Waiting for confirmation", hash, completed: hashes });
    const receipt = await waitForReceipt(hash);
    if (receipt.status !== "success") {
      throw new Error(`Transaction reverted: ${hash}`);
    }
    hashes.push({ description: transaction.description, hash, status: "mined" });
  }
  return hashes;
}

prepareButton.addEventListener("click", async () => {
  prepareButton.disabled = true;
  executeButton.disabled = true;
  try {
    const provider = await requireProvider();
    await switchToShannon(provider);
    const [account] = await provider.request({ method: "eth_requestAccounts" });
    const response = await fetch(`/api/prepare?account=${encodeURIComponent(account)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not prepare order.");
    plan = result;
    show({
      notice: "No transaction has been sent. Check these details before signing.",
      account: plan.account,
      market: plan.market,
      order: {
        side: plan.order.side,
        timeInForce: plan.order.timeInForce,
        contracts: formatRaw(plan.order.quantity),
        bestAsk: formatRaw(plan.order.bestAsk),
        limitPrice: formatRaw(plan.order.limitPrice),
        maximumCostTUSDC: formatRaw(plan.order.maximumCost),
      },
      balancesBefore: {
        tUSDC: formatRaw(plan.balancesBefore.collateral),
        yesContracts: formatRaw(plan.balancesBefore.yes),
      },
      transactionCount: plan.transactions.length,
    });
    executeButton.disabled = false;
  } catch (error) {
    show(error instanceof Error ? error.message : String(error));
  } finally {
    prepareButton.disabled = false;
  }
});

executeButton.addEventListener("click", async () => {
  executeButton.disabled = true;
  try {
    const provider = await requireProvider();
    const [currentAccount] = await provider.request({ method: "eth_accounts" });
    if (currentAccount?.toLowerCase() !== plan.account.toLowerCase()) {
      throw new Error("The connected wallet changed. Prepare the order again.");
    }

    const checkResponse = await fetch(
      `/api/check?account=${encodeURIComponent(plan.account)}`,
    );
    const check = await checkResponse.json();
    if (!checkResponse.ok) {
      throw new Error(check.error ?? "Could not check the prepared order.");
    }
    if (!check.safeToSubmit || check.marketId !== plan.market.marketId) {
      throw new Error(
        "The prepared market is no longer safely tradable. Prepare a new order.",
      );
    }

    const hashes = [];
    for (const transaction of plan.transactions) {
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: transaction.from,
          to: transaction.to,
          data: transaction.data,
          value: transaction.value,
        }],
      });
      show({ status: "Waiting for confirmation", hash, completed: hashes });
      const receipt = await waitForReceipt(hash);
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${hash}`);
      }
      hashes.push({ description: transaction.description, hash, status: "mined" });
    }
    const verificationResponse = await fetch(
      `/api/verify?account=${encodeURIComponent(plan.account)}`,
    );
    const verification = await verificationResponse.json();
    if (!verificationResponse.ok) {
      throw new Error(verification.error ?? "Could not verify position.");
    }
    show({
      result: "Transactions mined",
      marketId: plan.market.marketId,
      yesTokenId: plan.market.yesTokenId,
      hashes,
      balancesBefore: {
        tUSDC: formatRaw(plan.balancesBefore.collateral),
        yesContracts: formatRaw(plan.balancesBefore.yes),
      },
      balancesAfter: {
        tUSDC: formatRaw(verification.balancesAfter.collateral),
        yesContracts: formatRaw(verification.balancesAfter.yes),
      },
    });
  } catch (error) {
    show(error instanceof Error ? error.message : String(error));
    executeButton.disabled = false;
  }
});

mintSetButton.addEventListener("click", async () => {
  mintSetButton.disabled = true;
  try {
    const { provider, account } = await connectedWallet();
    const response = await fetch(
      `/api/prepare-set?account=${encodeURIComponent(account)}`,
    );
    const setPlan = await response.json();
    if (!response.ok) throw new Error(setPlan.error ?? "Could not prepare complete set.");
    const confirmed = window.confirm(
      `Mint one YES + one NO for 1 tUSDC on ${setPlan.market.symbol}?`,
    );
    if (!confirmed) return;
    const hashes = await executeTransactions(provider, setPlan.transactions);
    window.localStorage.setItem("redemptionMarketId", setPlan.market.marketId);
    show({
      result: "Complete set minted",
      market: setPlan.market,
      amount: "1 YES + 1 NO",
      hashes,
      next: "Return after the displayed expiry and click Redeem winner.",
    });
  } catch (error) {
    show(error instanceof Error ? error.message : String(error));
  } finally {
    mintSetButton.disabled = false;
  }
});

redeemButton.addEventListener("click", async () => {
  redeemButton.disabled = true;
  try {
    const marketId = window.localStorage.getItem("redemptionMarketId");
    if (!marketId) throw new Error("Mint a complete set before attempting redemption.");
    const { provider, account } = await connectedWallet();
    const response = await fetch(
      `/api/prepare-redeem?account=${encodeURIComponent(account)}`
        + `&marketId=${encodeURIComponent(marketId)}`,
    );
    const redemption = await response.json();
    if (!response.ok) throw new Error(redemption.error ?? "Could not prepare redemption.");
    const confirmed = window.confirm(
      `Redeem one winning ${redemption.winner} contract for 1 tUSDC?`,
    );
    if (!confirmed) return;
    const hashes = await executeTransactions(provider, redemption.transactions);
    show({ result: "Winning contract redeemed", ...redemption, hashes });
  } catch (error) {
    show(error instanceof Error ? error.message : String(error));
  } finally {
    redeemButton.disabled = false;
  }
});
