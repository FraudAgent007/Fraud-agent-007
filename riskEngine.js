function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

function unique(arr) {
  return [...new Set(arr)];
}

function analyzeRisk(rawText, label) {
  const text = (rawText || "").toLowerCase();

  let score = 0;
  let redFlags = [];
  let nextChecks = [];

  // social / scam patterns
  if (hasAny(text, ["airdrop", "early access", "guaranteed", "guarantee", "100x"])) {
    score += 20;
    redFlags.push("promotion-heavy bait");
    nextChecks.push("verify whether the offer exists on official channels");
  }

  if (hasAny(text, ["urgent", "now", "limited", "last chance", "act fast"])) {
    score += 20;
    redFlags.push("urgency pressure");
    nextChecks.push("slow down and verify source authenticity");
  }

  if (hasAny(text, ["http", "link", "website", "connect wallet"])) {
    score += 20;
    redFlags.push("external link or wallet-connect risk");
    nextChecks.push("verify the real domain before clicking or connecting");
  }

  if (hasAny(text, ["support", "admin", "team dm", "dm me"])) {
    score += 20;
    redFlags.push("impersonation or fake support pattern");
    nextChecks.push("verify whether the account is the official source");
  }

  // contract / token patterns
  if (hasAny(text, ["mint", "blacklist", "proxy", "owner", "ownership", "admin"])) {
    score += 20;
    redFlags.push("privileged contract controls");
    nextChecks.push("check owner privileges, mint rights, and blacklist logic");
  }

  if (hasAny(text, ["tax", "sell tax", "buy tax", "can’t sell", "cant sell", "honeypot"])) {
    score += 25;
    redFlags.push("transfer restriction or honeypot risk");
    nextChecks.push("verify sell behavior and transfer restrictions");
  }

  // project structure patterns
  if (hasAny(text, ["whale", "holders", "holder", "supply", "concentration"])) {
    score += 15;
    redFlags.push("holder concentration risk");
    nextChecks.push("review top holder distribution");
  }

  if (hasAny(text, ["liquidity", "lp", "locked", "burned", "burnt"])) {
    score += 15;
    redFlags.push("liquidity control risk");
    nextChecks.push("verify who controls liquidity and whether LP is locked");
  }

  // wallet patterns
  if (hasAny(text, ["wallet", "address", "approvals", "approval", "drain"])) {
    score += 15;
    redFlags.push("wallet interaction risk");
    nextChecks.push("check token approvals and suspicious counterparties");
  }

  // label-based weighting
  if (label === "scam_alert") score += 20;
  if (label === "contract_risk") score += 15;
  if (label === "wallet_risk") score += 10;
  if (label === "project_dd") score += 10;

  score = Math.min(score, 100);

  let riskLevel = "low";
  if (score >= 70) riskLevel = "high";
  else if (score >= 40) riskLevel = "medium";

  redFlags = unique(redFlags).slice(0, 3);
  nextChecks = unique(nextChecks).slice(0, 3);

  if (redFlags.length === 0) {
    redFlags.push("insufficient hard evidence in text alone");
  }

  if (nextChecks.length === 0) {
    nextChecks.push("verify control, liquidity, and permissions before trusting it");
  }

  return {
    riskLevel,
    score,
    redFlags,
    nextChecks,
  };
}

module.exports = { analyzeRisk };