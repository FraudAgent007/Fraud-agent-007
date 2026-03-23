async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "FraudAgent007/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.json();
}

function extractAddress(text) {
  const match = (text || "").match(/\b0x[a-fA-F0-9]{40}\b/);
  return match ? match[0] : null;
}

function extractTickers(text) {
  const matches = (text || "").match(/\$([A-Za-z0-9]{2,15})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((t) => t.replace("$", "").toUpperCase()))];
}

const MAJOR_TOKENS = ["BTC", "ETH", "BNB", "SOL"];

function isMajorToken(symbol) {
  return MAJOR_TOKENS.includes((symbol || "").toUpperCase());
}

async function searchDexPairs(query) {
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  return data?.pairs || [];
}

function scorePair(pair) {
  const liquidity = Number(pair?.liquidity?.usd || 0);
  const volume = Number(pair?.volume?.h24 || 0);
  const buys = Number(pair?.txns?.h24?.buys || 0);
  const sells = Number(pair?.txns?.h24?.sells || 0);

  return liquidity * 0.6 + volume * 0.3 + (buys + sells) * 10;
}

function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;

  return [...pairs].sort((a, b) => scorePair(b) - scorePair(a))[0];
}

async function getDexContextFromText(text) {
  const address = extractAddress(text);
  const tickers = extractTickers(text);

  // 1. Address mention = strongest signal
  if (address) {
    const pairs = await searchDexPairs(address);
    const bestPair = pickBestPair(pairs);

    if (!bestPair) return null;

    return {
      type: "address",
      address,
      token: bestPair.baseToken?.symbol || null,
      bestPair,
      pairs,
    };
  }

  // 2. Multiple tickers = comparison / broad context, skip direct lookup
  if (tickers.length > 1) {
    return {
      type: "multi_token",
      tokens: tickers,
    };
  }

  // 3. Single ticker
  if (tickers.length === 1) {
    const token = tickers[0];

    // skip majors to avoid weird wrapped/bridged pair matches
    if (isMajorToken(token)) {
      return {
        type: "major_token",
        token,
      };
    }

    const pairs = await searchDexPairs(token);
    const bestPair = pickBestPair(pairs);

    if (!bestPair) return null;

    return {
      type: "token",
      token,
      bestPair,
      pairs,
    };
  }

  return null;
}

function mapDexChainToHoneypot(chainId) {
  const map = {
    ethereum: 1,
    bsc: 56,
    polygon: 137,
    base: 8453,
    arbitrum: 42161,
    avalanche: 43114,
  };

  return map[chainId] || null;
}

async function getHoneypotContext(chainId, tokenAddress) {
  if (!chainId || !tokenAddress) return null;

  const url = `https://api.honeypot.is/v2/IsHoneypot?chainID=${encodeURIComponent(
    chainId
  )}&address=${encodeURIComponent(tokenAddress)}`;

  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
}

function summarizeOnchain(dexContext, honeypotContext) {
  const summary = {
    found: false,
    chainId: null,
    dexId: null,
    tokenAddress: null,
    tokenSymbol: null,
    pairAddress: null,
    pairUrl: null,
    priceUsd: null,
    liquidityUsd: null,
    volume24h: null,
    fdv: null,
    marketCap: null,
    pairAgeMs: null,
    buys24h: null,
    sells24h: null,
    honeypot: null,
    buyTax: null,
    sellTax: null,
    transferTax: null,
    flags: [],
    nextChecks: [],
  };

  if (!dexContext?.bestPair) {
    return summary;
  }

  const pair = dexContext.bestPair;

  summary.found = true;
  summary.chainId = pair.chainId || null;
  summary.dexId = pair.dexId || null;
  summary.tokenAddress = pair.baseToken?.address || dexContext.address || null;
  summary.tokenSymbol = pair.baseToken?.symbol || dexContext.token || null;
  summary.pairAddress = pair.pairAddress || null;
  summary.pairUrl = pair.url || null;
  summary.priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
  summary.liquidityUsd = pair.liquidity?.usd ?? null;
  summary.volume24h = pair.volume?.h24 ?? null;
  summary.fdv = pair.fdv ?? null;
  summary.marketCap = pair.marketCap ?? null;
  summary.pairAgeMs = pair.pairCreatedAt
    ? Date.now() - Number(pair.pairCreatedAt)
    : null;
  summary.buys24h = pair.txns?.h24?.buys ?? null;
  summary.sells24h = pair.txns?.h24?.sells ?? null;

  if ((summary.liquidityUsd ?? 0) < 25000) {
    summary.flags.push("low_liquidity");
    summary.nextChecks.push("verify LP depth and who controls liquidity");
  }

  if (summary.pairAgeMs !== null && summary.pairAgeMs < 24 * 60 * 60 * 1000) {
    summary.flags.push("new_pair");
    summary.nextChecks.push("treat fresh pools as high-risk until structure is verified");
  }

  if (
    summary.buys24h !== null &&
    summary.sells24h !== null &&
    summary.buys24h > 0 &&
    summary.sells24h === 0
  ) {
    summary.flags.push("buy_sell_imbalance");
    summary.nextChecks.push("verify whether sells are functioning normally");
  }

  if (honeypotContext) {
    summary.honeypot = honeypotContext?.honeypotResult?.isHoneypot ?? null;
    summary.buyTax = honeypotContext?.simulationResult?.buyTax ?? null;
    summary.sellTax = honeypotContext?.simulationResult?.sellTax ?? null;
    summary.transferTax = honeypotContext?.simulationResult?.transferTax ?? null;

    if (summary.honeypot === true) {
      summary.flags.push("honeypot_detected");
      summary.nextChecks.push("do not assume exits are possible without confirming sell behavior");
    }

    if ((summary.sellTax ?? 0) >= 20) {
      summary.flags.push("high_sell_tax");
      summary.nextChecks.push("verify whether sell tax makes exits non-viable");
    }
  }

  summary.flags = [...new Set(summary.flags)];
  summary.nextChecks = [...new Set(summary.nextChecks)];

  return summary;
}

module.exports = {
  extractAddress,
  extractTickers,
  isMajorToken,
  getDexContextFromText,
  getHoneypotContext,
  mapDexChainToHoneypot,
  summarizeOnchain,
};