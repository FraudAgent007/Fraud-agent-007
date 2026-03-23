const OpenAI = require("openai");
const { summarizeSignals } = require("./signalEngine");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function shouldCreateThreatBrief(state) {
  const now = Date.now();
  const lastPostTime = state.lastPostTime || 0;

  const minGapMs = 6 * 60 * 60 * 1000;
  if (now - lastPostTime < minGapMs) {
    return { allow: false, reason: "cooldown" };
  }

  const summary = summarizeSignals(state);

  if (summary.totalWeight < 12) {
    return { allow: false, reason: "not_enough_weight", summary };
  }

  return {
    allow: true,
    reason: "enough_signal_weight",
    summary,
    recentSignals: (state.recentSignals || []).slice(-10),
  };
}

async function generateThreatBrief(recentSignals, summary) {
  const prompt = `
You are Fraud Agent 007, a Web3 fraud intelligence account on X.

Write ONE concise threat brief post.

Recent signals:
${JSON.stringify(recentSignals, null, 2)}

Signal summary:
${JSON.stringify(summary, null, 2)}

Rules:
- serious
- concise
- crypto-native
- no hype
- no emojis
- no hashtags
- max 260 characters
- sound like a threat analyst
- identify the strongest recurring pattern
- state what users should verify next
- end with "$F007"
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: prompt,
  });

  return (
    response.output_text ||
    "Threat brief: urgency, external links, and privileged-control patterns are clustering again. Verify the real domain, LP control, and owner permissions before trusting the setup. $F007"
  ).trim();
}

module.exports = {
  shouldCreateThreatBrief,
  generateThreatBrief,
};