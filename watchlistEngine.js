const { WATCHLIST } = require("./watchlist");

async function fetchWatchlistSignals(rwClient, classifyMention, analyzeRisk) {
  const collectedSignals = [];

  for (const username of WATCHLIST) {
    try {
      const user = await rwClient.v2.userByUsername(username);
      const userId = user?.data?.id;
      if (!userId) continue;

      const tweets = await rwClient.v2.userTimeline(userId, {
        max_results: 5,
        exclude: ["replies", "retweets"],
        "tweet.fields": ["created_at"]
      });

      const items = tweets?.data?.data || [];
      for (const tweet of items) {
        const classification = await classifyMention(tweet.text);
        const risk = analyzeRisk(tweet.text, classification.label);

        collectedSignals.push({
          source: username,
          tweetId: tweet.id,
          text: tweet.text,
          label: classification.label,
          confidence: classification.confidence || 0,
          riskLevel: risk.riskLevel,
          score: risk.score,
          redFlags: risk.redFlags,
          time: Date.now(),
        });
      }
    } catch (err) {
      console.error(`Watchlist fetch failed for ${username}:`, err.message || err);
    }
  }

  return collectedSignals;
}

function mergeWatchlistSignals(state, signals) {
  const now = Date.now();

  const existing = state.recentSignals || [];
  const merged = [...existing];

  for (const signal of signals) {
    const exists = merged.some(
      (s) => s.tweetId === signal.tweetId && s.source === signal.source
    );
    if (!exists) merged.push(signal);
  }

  state.recentSignals = merged
    .filter((s) => now - s.time < 24 * 60 * 60 * 1000)
    .slice(-300);

  return state;
}

module.exports = {
  fetchWatchlistSignals,
  mergeWatchlistSignals,
};