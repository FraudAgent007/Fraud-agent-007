function updateSignalMemory(state, tweet, classification, risk) {
  const signal = {
    tweetId: tweet.id,
    text: tweet.text,
    label: classification.label,
    confidence: classification.confidence,
    riskLevel: risk.riskLevel,
    weight: risk.score,
    pattern: null,
    time: Date.now()
  };

  state.recentSignals = [...(state.recentSignals || []), signal]
    .filter((s) => Date.now() - s.time < 24 * 60 * 60 * 1000)
    .slice(-300);

  return signal;
}

module.exports = { updateSignalMemory };