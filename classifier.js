const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function fastRuleClassify(tweetText) {
  const text = (tweetText || "").toLowerCase();

  const explicitScan =
    text.includes("check ") ||
    text.includes("scan ") ||
    text.includes("what do you think") ||
    text.includes("thoughts on") ||
    text.includes("is this safe") ||
    text.includes("is this a rug") ||
    text.includes("safe?") ||
    text.includes("rug?") ||
    text.includes("intel on") ||
    text.includes("main risk") ||
    text.includes("look at ");

  const hasTicker = /\$[a-z0-9]{2,15}\b/i.test(tweetText || "");
  const hasAddress = /\b0x[a-fA-F0-9]{40}\b/.test(tweetText || "");

  if (explicitScan && (hasTicker || hasAddress)) {
    return {
      label: "project_dd",
      confidence: 0.93,
      reason: "explicit token scan request",
    };
  }

  if (
    text.includes("phishing") ||
    text.includes("fake support") ||
    text.includes("drain") ||
    text.includes("wallet drained") ||
    text.includes("scam link") ||
    text.includes("malicious")
  ) {
    return {
      label: "scam_alert",
      confidence: 0.92,
      reason: "explicit scam-style language",
    };
  }

  return null;
}

async function classifyMention(tweetText) {
  const fast = fastRuleClassify(tweetText);
  if (fast) return fast;

  const prompt = `
You classify X mentions for Fraud Agent 007, a Web3 scam and risk intelligence agent.

Return ONLY valid JSON with this exact shape:
{"label":"ignore|wallet_risk|contract_risk|project_dd|scam_alert|security_education","confidence":0.0,"reason":"short"}

Label meanings:
- ignore = greeting, nonsense, generic ping, no real risk question
- wallet_risk = asks about a wallet, address, approvals, drain risk, suspicious wallet behavior
- contract_risk = asks about CA, contract, taxes, honeypot, blacklist, ownership, mint, transfer restrictions, admin controls
- project_dd = asks whether a token/project is safe, legit, worth checking, risky, suspicious, or asks for a scan / opinion on a token or project
- scam_alert = obvious scam pattern, phishing, fake support, exploit, rug, drain, malicious link, urgency + link + tags
- security_education = asks what to check, how to avoid scams, red flags, due diligence, wallet safety

Rules:
- Be strict but crypto-native.
- Direct asks like "check $TOKEN", "scan $TOKEN", "what do you think about $TOKEN", "is this a rug?" are usually project_dd, not ignore.
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