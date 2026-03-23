const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function classifyMention(tweetText) {
  const prompt = `
You classify X mentions for Fraud Agent 007, a Web3 scam and risk intelligence agent.

Return ONLY valid JSON with this exact shape:
{"label":"ignore|wallet_risk|contract_risk|project_dd|scam_alert|security_education","confidence":0.0,"reason":"short"}

Label meanings:
- ignore = greeting, nonsense, generic ping, no real risk question
- wallet_risk = asks about a wallet, address, approvals, drain risk, suspicious wallet behavior
- contract_risk = asks about CA, contract, taxes, honeypot, blacklist, ownership, mint, transfer restrictions, admin controls
- project_dd = asks whether a token/project is safe, legit, worth checking, worth buying, risky, suspicious, or asks for intel / thoughts / opinion about a crypto project
- scam_alert = obvious scam pattern, phishing, fake support, exploit, rug, drain, malicious link, urgency + link + tags
- security_education = asks what to check, how to avoid scams, red flags, due diligence, wallet safety

Rules:
- Be strict, but crypto-native.
- "safe?", "thoughts?", "intel?", "is this legit?", "rug?", "check this token" are usually NOT ignore.
- Greetings alone are ignore.
- Confidence must be between 0 and 1.
- Return JSON only.

Mention:
"${tweetText}"
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: prompt,
  });

  const text = (response.output_text || "").trim();

  try {
    return JSON.parse(text);
  } catch {
    return {
      label: "ignore",
      confidence: 0,
      reason: "parse_failed",
    };
  }
}

module.exports = { classifyMention };