const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateAlphaPost(pattern, strength) {
  const prompt = `
You are Fraud Agent 007, a Web3 risk intelligence system.

Write a short intelligence-style post.

Pattern:
${pattern}

Strength:
${strength}

Rules:
- concise
- sharp
- no hype
- no emojis
- no hashtags
- no filler
- max 220 characters
- explain what is happening + what to verify
- end with "$F007"
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: prompt,
  });

  return (
    response.output_text ||
    "Signal cluster detected across scam patterns. Verify domains, contract permissions, and control exposure before interacting. $F007"
  ).trim();
}

module.exports = { generateAlphaPost };