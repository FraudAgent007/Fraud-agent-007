function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

function extractTickers(text) {
  const matches = (text || "").match(/\$([A-Za-z0-9]{2,15})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((t) => t.replace("$", "").toUpperCase()))];
}

const MAJOR_TOKENS = ["BTC", "ETH", "BNB", "SOL", "USDT", "USDC"];

function isMajorToken(symbol) {
  return MAJOR_TOKENS.includes((symbol || "").toUpperCase());
}

function patternKey(text) {
  const t = (text || "").toLowerCase();
  const tickers = extractTickers(text);

  const hasLink = hasAny(t, ["http", "www", "link", ".com", ".io", ".xyz"]);
  const hasUrgency = hasAny(t, [
    "urgent",
    "now",
    "limited",
    "last chance",
    "act fast",
    "early access",
    "claim now",
  ]);
  const hasScamWords = hasAny(t, [
    "airdrop",
    "mint",
    "drain",
    "rug",
    "honeypot",
    "phishing",
    "fake support",
    "dm",
    "support",
  ]);
  const hasPromoWords = hasAny(t, [
    "gem",
    "moon",
    "100x",
    "lfg",
    "bullish",
    "buy now",
    "launching",
    "presale",
    "pump",
  ]);

  if (hasLink && hasUrgency) return "urgency_link";
  if (hasAny(t, ["airdrop", "early access"])) return "airdrop_bait";
  if (hasAny(t, ["dm", "support", "admin"])) return "impersonation";
  if (hasAny(t, ["mint", "owner", "blacklist"])) return "privileged_controls";
  if (hasAny(t, ["honeypot", "tax", "cant sell", "can't sell"])) return "sell_restriction";
  if (hasLink) return "external_link";

  if (tickers.length > 1 && tickers.every((tk) => isMajorToken(tk))) {
    return "asset_comparison";
  }

  if (tickers.length >= 1 && (hasPromoWords || hasScamWords)) {
    return "token_promo";
  }

  if (tickers.length === 1 && isMajorToken(tickers[0])) {
    return "major_asset_mention";
  }

  if (tickers.length >= 1) {
    return "token_mention";
  }

  return "generic";
}

function signalWeight(label, risk) {
  let score = 0;

  if (label === "scam_alert") score += 4;
  if (label === "contract_risk") score += 3;
  if (label === "wallet_risk") score += 2;
  if (label === "project_dd") score += 2;
  if (label === "security_education") score += 1;

  if (risk?.riskLevel === "high") score += 3;
  else if (risk?.riskLevel === "medium") score += 2;
  else score += 1;

  return score;
}

function updateSignalMemory(state, tweet, classification, risk) {
  const now = Date.now();
  const pattern = patternKey(tweet.text);
  const weight = signalWeight(classification.label, risk);

  const signal = {
    tweetId: tweet.id,
    text: tweet.text,
    label: classification.label,
    confidence: classification.confidence || 0,
    riskLevel: risk?.riskLevel || "unknown",
    weight,
    pattern,
    time: now,
  };

  state.recentSignals = [...(state.recentSignals || []), signal]
    .filter((s) => now - s.time < 24 * 60 * 60 * 1000)
    .slice(-200);

  return signal;
}

function summarizeSignals(state) {
  const signals = state.recentSignals || [];

  const byPattern = {};
  const byLabel = {};
  let totalWeight = 0;

  for (const s of signals) {
    byPattern[s.pattern] = (byPattern[s.pattern] || 0) + s.weight;
    byLabel[s.label] = (byLabel[s.label] || 0) + 1;
    totalWeight += s.weight;
  }

  const topPatterns = Object.entries(byPattern)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pattern, weight]) => ({ pattern, weight }));

  return {
    totalSignals: signals.length,
    totalWeight,
    byLabel,
    topPatterns,
  };
}

module.exports = {
  updateSignalMemory,
  summarizeSignals,
};