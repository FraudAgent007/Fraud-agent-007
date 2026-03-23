function extractTickers(text) {
  const matches = (text || "").match(/\$([A-Za-z0-9]{2,15})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((t) => t.replace("$", "").toUpperCase()))];
}

const MAJOR_TOKENS = ["BTC", "ETH", "BNB", "SOL", "USDT", "USDC"];

function isMajorToken(symbol) {
  return MAJOR_TOKENS.includes((symbol || "").toUpperCase());
}

function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

function normalizePattern(text) {
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

  // strongest scam-style patterns first
  if (hasLink && hasUrgency) return "urgency_link";
  if (hasAny(t, ["airdrop", "early access"])) return "airdrop_bait";
  if (hasAny(t, ["dm", "support", "admin"])) return "impersonation";
  if (hasAny(t, ["mint", "owner", "blacklist"])) return "privileged_controls";
  if (hasAny(t, ["honeypot", "tax", "cant sell", "can't sell"])) return "sell_restriction";
  if (hasLink) return "external_link";

  // multi-major-token comparison should NOT be promo
  if (
    tickers.length > 1 &&
    tickers.every((tk) => isMajorToken(tk))
  ) {
    return "asset_comparison";
  }

  // single/unknown token with hype words = promo
  if (tickers.length >= 1 && (hasPromoWords || hasScamWords)) {
    return "token_promo";
  }

  // single major token mention alone is just market chatter
  if (tickers.length === 1 && isMajorToken(tickers[0])) {
    return "major_asset_mention";
  }

  if (tickers.length >= 1) {
    return "token_mention";
  }

  return "generic";
}

function updatePatternMemory(state, text) {
  const pattern = normalizePattern(text);
  const now = Date.now();

  const existing = state.recentSignals || [];

  const updated = [
    ...existing,
    { pattern, time: now }
  ].filter((p) => now - p.time < 6 * 60 * 60 * 1000); // keep 6h

  state.recentSignals = updated;

  return pattern;
}

function detectPatternStrength(state, pattern) {
  const signals = state.recentSignals || [];
  const matches = signals.filter((s) => s.pattern === pattern);
  return matches.length;
}

function humanizePattern(pattern) {
  return (pattern || "").replace(/_/g, " ");
}

function getPatternInsight(state, text) {
  const pattern = normalizePattern(text);
  const count = detectPatternStrength(state, pattern);

  // don't generate noisy insights for harmless categories
  const ignoredInsightPatterns = [
    "generic",
    "major_asset_mention",
    "asset_comparison",
    "token_mention",
  ];

  if (ignoredInsightPatterns.includes(pattern)) {
    return null;
  }

  if (count >= 3) {
    return `Recurring pattern detected (${humanizePattern(pattern)} seen ${count} times).`;
  }

  return null;
}

module.exports = {
  updatePatternMemory,
  getPatternInsight,
};