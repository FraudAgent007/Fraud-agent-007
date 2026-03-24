function scoreThreatSignal(signal) {
  let score = 0;

  if (signal?.label === "scam_alert") score += 6;
  if (signal?.label === "contract_risk") score += 4;
  if (signal?.label === "wallet_risk") score += 4;
  if (signal?.pattern === "external_link") score += 5;
  if (signal?.pattern === "broadcast_spam") score += 5;
  if (signal?.riskLevel === "high") score += 4;
  if (signal?.riskLevel === "medium") score += 2;

  return score;
}

function summarizeThreatWindow(state) {
  const now = Date.now();
  const recentSignals = (state.recentSignals || []).filter(
    (s) => now - s.time < 6 * 60 * 60 * 1000
  );

  const patternScores = {};
  let totalScore = 0;

  for (const signal of recentSignals) {
    const score = scoreThreatSignal(signal);
    totalScore += score;
    const pattern = signal.pattern || "generic";
    patternScores[pattern] = (patternScores[pattern] || 0) + score;
  }

  const topPatterns = Object.entries(patternScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pattern, score]) => ({ pattern, score }));

  return {
    totalSignals: recentSignals.length,
    totalScore,
    topPatterns
  };
}

function shouldPostThreatBrief(state) {
  const now = Date.now();
  const lastThreatPostAt = state.lastThreatPostAt || 0;

  if (now - lastThreatPostAt < 4 * 60 * 60 * 1000) {
    return { allow: false, reason: "threat_cooldown" };
  }

  const summary = summarizeThreatWindow(state);

  if (summary.totalSignals < 4 || summary.totalScore < 18) {
    return {
      allow: false,
      reason: "insufficient_signal",
      summary
    };
  }

  return {
    allow: true,
    reason: "strong_cluster",
    summary
  };
}

module.exports = {
  shouldPostThreatBrief,
  summarizeThreatWindow
};