const { Interface, getAddress } = require("ethers");

const TRANSFER_ABI = new Interface([
  "function transfer(address,uint256) returns (bool)",
]);

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const json = await res.json();
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;

  return [...pairs]
    .filter((p) => p?.pairAddress)
    .sort(
      (a, b) =>
        Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)
    )[0];
}

async function simulateTransfer(rpc, tokenAddress, from, to, amount) {
  try {
    const data = TRANSFER_ABI.encodeFunctionData("transfer", [to, amount]);
    const raw = await rpc.ethCall({
      from,
      to: tokenAddress,
      data,
    });
    const [ok] = TRANSFER_ABI.decodeFunctionResult("transfer", raw);
    return ok === true;
  } catch {
    return false;
  }
}

async function detectSellBlock({
  rpc,
  dexChainId,
  tokenAddress,
  candidateHolder,
}) {
  if (!candidateHolder || !dexChainId || !tokenAddress) {
    return { found: false, reason: "missing_inputs" };
  }

  const token = getAddress(tokenAddress);
  const holder = getAddress(candidateHolder);

  const url = `https://api.dexscreener.com/token-pairs/v1/${dexChainId}/${token}`;
  const { status, json } = await fetchJson(url);

  if (status !== 200 || !Array.isArray(json)) {
    return { found: false, reason: "no_pairs" };
  }

  const bestPair = pickBestPair(json);
  if (!bestPair?.pairAddress) {
    return { found: false, reason: "no_pair_address" };
  }

  const pairAddress = getAddress(bestPair.pairAddress);
  const testEoa = "0x1111111111111111111111111111111111111111";
  const amount = 1n;

  const canTransferToEoa = await simulateTransfer(
    rpc,
    token,
    holder,
    testEoa,
    amount
  );

  if (!canTransferToEoa) {
    return {
      found: true,
      pairAddress,
      sellBlockedLikely: null,
      evidence: "holder_probe_failed",
    };
  }

  const canTransferToPair = await simulateTransfer(
    rpc,
    token,
    holder,
    pairAddress,
    amount
  );

  return {
    found: true,
    pairAddress,
    liquidityUsd: Number(bestPair?.liquidity?.usd || 0),
    sellBlockedLikely: canTransferToPair ? false : true,
    evidence: canTransferToPair
      ? "transfer_ok_to_pair"
      : "transfer_ok_to_eoa_but_fails_to_pair",
  };
}

module.exports = {
  detectSellBlock,
};