function extractAddress(text) {
  const m = (text || "").match(/\b0x[a-fA-F0-9]{40}\b/);
  return m ? m[0] : null;
}

function extractTicker(text) {
  const m = (text || "").match(/\$([A-Z0-9]{2,15})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function dexChainToRpcKey(chainId) {
  switch ((chainId || "").toLowerCase()) {
    case "ethereum":
      return "ETH_RPC_URLS";
    case "bsc":
      return "BSC_RPC_URLS";
    case "polygon":
      return "POLYGON_RPC_URLS";
    case "base":
      return "BASE_RPC_URLS";
    case "arbitrum":
      return "ARBITRUM_RPC_URLS";
    default:
      return null;
  }
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
    lower.includes("who has best security") ||
    lower.includes("strongest security") ||
    lower.includes("compare") ||
    ((text || "").match(/\$/g) || []).length > 1
  );
}

async function getDexContextFromText(text) {
  const address = extractAddress(text);
  const ticker = extractTicker(text);

  try {
    if (address) {
      const chains = ["ethereum", "bsc", "base", "polygon", "arbitrum"];

      for (const chain of chains) {
        const url = `https://api.dexscreener.com/token-pairs/v1/${chain}/${address}`;
        const res = await fetch(url);
        if (!res.ok) continue;

        const pairs = await res.json();
        if (!Array.isArray(pairs) || !pairs.length) continue;

        const bestPair = [...pairs].sort(
          (a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)
        )[0];

        return {
          found: true,
          matchConfidence: "high",
          bestPair,
          type: "address_match"
        };
      }
    }

    if (ticker && isMajorTicker(ticker) && isBroadQuestion(text)) {
      return { found: false, type: "broad_major_asset_question" };
    }

    if (!ticker) return { found: false, type: "none" };

    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(ticker)}`
    );

    if (!res.ok) return { found: false, type: "none" };

    const json = await res.json();
    const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
    if (!pairs.length) return { found: false, type: "none" };

    const exactSymbol = pairs.filter(
      (p) => (p?.baseToken?.symbol || "").toUpperCase() === ticker
    );

    const candidates = exactSymbol.length ? exactSymbol : pairs;

    const bestPair = [...candidates].sort(
      (a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)
    )[0];

    return {
      found: true,
      matchConfidence: exactSymbol.length ? "high" : "medium",
      bestPair,
      type: "ticker_match"
    };
  } catch {
    return { found: false, type: "error" };
  }
}

function summarizeOnchain(ctx) {
  if (!ctx?.bestPair) {
    return {
      found: false,
      flags: [],
      nextChecks: []
    };
  }

  const p = ctx.bestPair;

  return {
    found: true,
    matchConfidence: ctx.matchConfidence || "unknown",
    chainId: p.chainId || null,
    dexId: p.dexId || null,
    tokenAddress: p.baseToken?.address || null,
    tokenSymbol: p.baseToken?.symbol || null,
    pairAddress: p.pairAddress || null,
    pairUrl: p.url || null,
    priceUsd: Number(p.priceUsd || 0),
    liquidityUsd: Number(p?.liquidity?.usd || 0),
    volume24h: Number(p?.volume?.h24 || 0),
    fdv: Number(p.fdv || 0),
    marketCap: Number(p.marketCap || 0),
    pairAgeMs: p.pairCreatedAt ? Date.now() - Number(p.pairCreatedAt) : null,
    buys24h: Number(p?.txns?.h24?.buys || 0),
    sells24h: Number(p?.txns?.h24?.sells || 0),
    flags: [],
    nextChecks: []
  };
}

module.exports = {
  extractAddress,
  extractTicker,
  dexChainToRpcKey,
  getDexContextFromText,
  summarizeOnchain
};