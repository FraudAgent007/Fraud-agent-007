function shouldPostAlpha(state) {
  const now = Date.now();
  const lastPostTime = state.lastAlphaPost || 0;

  // cooldown: 4 hours
  if (now - lastPostTime < 4 * 60 * 60 * 1000) {
    return { allow: false, reason: "cooldown" };
  }

  const signals = state.recentSignals || [];

  if (signals.length < 5) {
    return { allow: false, reason: "not_enough_signals" };
  }

  const patternCounts = {};

  for (const s of signals) {
    patternCounts[s.pattern] = (patternCounts[s.pattern] || 0) + s.weight;
  }

  const top = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])[0];

  if (!top || top[1] < 8) {
    return { allow: false, reason: "weak_cluster" };
  }

  return {
    allow: true,
    pattern: top[0],
    strength: top[1],
  };
}

module.exports = { shouldPostAlpha };