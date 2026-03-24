function extractAddress(text) {
  const m = (text || "").match(/\b0x[a-fA-F0-9]{40}\b/);
  return m ? m[0] : null;
}

function extractTicker(text) {
  const m = (text || "").match(/\$([A-Z0-9]{2,15})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function isMajorTicker(ticker) {
  return ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA"].includes(
    (ticker || "").toUpperCase()
  );
}

function isBroadQuestion(text) {
  const lower = (text || "").toLowerCase();
  return (
    lower.includes("best security") ||
    lower.includes("which is safer") ||
    (text.match(/\$/g) || []).length > 1
  );
}

async function getDexContextFromText(text) {
  const ticker = extractTicker(text);

  // 🔥 FIXED
  if (ticker && isMajorTicker(ticker) && isBroadQuestion(text)) {
    return { found: false };
  }

  if (!ticker) return { found: false };

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${ticker}`
    );
    const json = await res.json();

    if (!json?.pairs?.length) return { found: false };

    const best = json.pairs.sort(
      (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    return { found: true, bestPair: best };
  } catch {
    return { found: false };
  }
}

function summarizeOnchain(ctx) {
  if (!ctx?.bestPair) return { found: false };

  const p = ctx.bestPair;

  return {
    found: true,
    chainId: p.chainId,
    tokenAddress: p.baseToken.address,
    tokenSymbol: p.baseToken.symbol,
    liquidityUsd: p.liquidity?.usd || 0
  };
}

module.exports = {
  extractAddress,
  extractTicker,
  getDexContextFromText,
  summarizeOnchain
};