function scoreThreatSignal(signal) {
  let score = 0;

  const label = signal?.label || "";
  const pattern = signal?.pattern || "";
  const riskLevel = signal?.riskLevel || "low";

  if (label === "scam_alert") score += 5;
  if (label === "contract_risk") score += 4;
  if (label === "project_dd") score += 2;
  if (label === "wallet_risk") score += 3;

  if (riskLevel === "high") score += 4;
  if (riskLevel === "medium") score += 2;

  if (pattern === "urgency_link") score += 5;
  if (pattern === "airdrop_bait") score += 5;
  if (pattern === "impersonation") score += 5;
  if (pattern === "sell_restriction") score += 4;
  if (pattern === "privileged_controls") score += 4;
  if (pattern === "token_promo") score += 1;

  return score;
}

function summarizeThreatWindow(state) {
  const now = Date.now();
  const recentSignals = (state.recentSignals || []).filter(
    (s) => now - s.time < 6 * 60 * 60 * 1000
  );

  const patternCounts = {};
  const labelCounts = {};
  let totalScore = 0;

  for (const signal of recentSignals) {
    const score = scoreThreatSignal(signal);
    totalScore += score;

    const pattern = signal.pattern || "generic";
    const label = signal.label || "unknown";

    patternCounts[pattern] = (patternCounts[pattern] || 0) + score;
    labelCounts[label] = (labelCounts[label] || 0) + 1;
  }

  const topPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pattern, score]) => ({ pattern, score }));

  return {
    recentSignals,
    totalSignals: recentSignals.length,
    totalScore,
    labelCounts,
    topPatterns,
  };
}

function getThreatSeverity(summary) {
  if (!summary || summary.totalSignals === 0) {
    return { severity: "none", shouldPost: false };
  }

  if (summary.totalScore >= 30 || summary.totalSignals >= 6) {
    return { severity: "high", shouldPost: true };
  }

  if (summary.totalScore >= 18 || summary.totalSignals >= 4) {
    return { severity: "medium", shouldPost: true };
  }

  if (summary.totalScore >= 10) {
    return { severity: "low", shouldPost: false };
  }

  return { severity: "none", shouldPost: false };
}

function shouldPostThreatBrief(state) {
  const now = Date.now();
  const lastThreatPostAt = state.lastThreatPostAt || 0;

  if (now - lastThreatPostAt < 4 * 60 * 60 * 1000) {
    return {
      allow: false,
      reason: "threat_cooldown",
    };
  }

  const summary = summarizeThreatWindow(state);
  const verdict = getThreatSeverity(summary);

  if (!verdict.shouldPost) {
    return {
      allow: false,
      reason: "insufficient_threat_signal",
      summary,
      severity: verdict.severity,
    };
  }

  if (!summary.topPatterns.length) {
    return {
      allow: false,
      reason: "no_dominant_pattern",
      summary,
      severity: verdict.severity,
    };
  }

  return {
    allow: true,
    reason: "strong_threat_signal",
    severity: verdict.severity,
    summary,
  };
}

module.exports = {
  scoreThreatSignal,
  summarizeThreatWindow,
  getThreatSeverity,
  shouldPostThreatBrief,
};