function analyzeRisk(text, label) {
  const t = (text || "").toLowerCase();

  let score = 0;
  let riskLevel = "low";
  const redFlags = [];
  const nextChecks = [];

  if (label === "scam_alert") {
    score += 40;
    redFlags.push("phishing or malicious link structure");
    nextChecks.push("verify the real domain before clicking");
  }

  if (label === "project_dd") {
    score += 10;
    redFlags.push("insufficient hard evidence in text alone");
    nextChecks.push("verify control, liquidity, and permissions before trusting it");
  }

  if (label === "contract_risk") {
    score += 25;
    redFlags.push("contract control concerns implied");
    nextChecks.push("check owner, proxy, mint, and blacklist permissions");
  }

  if (t.includes("http")) {
    score += 15;
    redFlags.push("external link or wallet-connect risk");
    nextChecks.push("confirm official source before interacting");
  }

  if (t.includes("claim") || t.includes("airdrop")) {
    score += 15;
    redFlags.push("urgency or reward bait");
    nextChecks.push("verify legitimacy through official channels");
  }

  if (t.includes("owner") || t.includes("proxy") || t.includes("mint")) {
    score += 10;
  }

  if (score >= 60) riskLevel = "high";
  else if (score >= 30) riskLevel = "medium";

  return {
    riskLevel,
    score,
    redFlags: [...new Set(redFlags)],
    nextChecks: [...new Set(nextChecks)]
  };
}

module.exports = { analyzeRisk };