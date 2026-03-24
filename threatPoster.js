const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateThreatBrief({ severity, summary }) {
  const prompt = `
You are Fraud Agent 007, a sharp Web3 threat intelligence account on X.

Write one autonomous threat brief post.

Rules:
- concise
- high-signal
- no emojis
- no hashtags
- no hype
- no fluff
- sound like a threat analyst
- 220 characters max
- end with "$F007"

Use these inputs:

Severity:
${severity}

Signal summary:
${JSON.stringify(summary, null, 2)}

Guidance:
- focus on the most dominant recurring risk pattern
- mention what users should verify next
- if severity is high, sound more urgent but still professional
- do not overclaim certainty
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: prompt,
  });

  const text = (response.output_text || "").trim();

  if (!text) {
    return "Threat brief: repeated scam-style signals are clustering again. Verify official channels, contract control, and outbound links before interacting. $F007";
  }

  return text;
}

module.exports = { generateThreatBrief };