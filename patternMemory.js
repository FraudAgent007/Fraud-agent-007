function detectPattern(text) {
  const t = (text || "").toLowerCase();

  if (t.includes("http")) return "external_link";
  if (/\$[A-Z0-9]{2,15}\b/i.test(text || "")) return "token_mention";
  if (t.includes("system update") || t.includes("private signal")) return "broadcast_spam";
  return "generic";
}

function updatePatternMemory(state, text) {
  const pattern = detectPattern(text);
  state.patternCounts = state.patternCounts || {};
  state.patternCounts[pattern] = (state.patternCounts[pattern] || 0) + 1;
  return pattern;
}

function getPatternInsight(state, text) {
  const pattern = detectPattern(text);
  const count = state.patternCounts?.[pattern] || 0;
  if (count >= 5) {
    return `Recurring pattern detected (${pattern} seen ${count} times).`;
  }
  return null;
}

module.exports = {
  updatePatternMemory,
  getPatternInsight
};