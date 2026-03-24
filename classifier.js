const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function hasTicker(text) {
  return /\$[A-Z0-9]{2,15}\b/i.test(text || "");
}

function hasAddress(text) {
  return /\b0x[a-fA-F0-9]{40}\b/.test(text || "");
}

function fastRuleClassify(tweetText) {
  const text = (tweetText || "").toLowerCase();
  const explicitScan =
    text.includes("check ") ||
    text.includes("scan ") ||
    text.includes("what do you think") ||
    text.includes("thoughts on") ||
    text.includes("main risk") ||
    text.includes("look at ") ||
    text.includes("is this safe") ||
    text.includes("is this a rug");

  if (explicitScan && (hasTicker(tweetText) || hasAddress(tweetText))) {
    return {
      label: "project_dd",
      confidence: 0.93,
      reason: "explicit token scan request"
    };
  }

  if (
    text.includes("system update") ||
    text.includes("private signal") ||
    text.includes("backstage access") ||
    text.includes("technical core") ||
    text.includes("verified network") ||
    text.includes("claim now") ||
    text.includes("wallet connect") ||
    (text.includes("check this out") && text.includes("http"))
  ) {
    return {
      label: "scam_alert",
      confidence: 0.9,
      reason: "common phishing or scam-broadcast pattern"
    };
  }

  if (
    text.includes("owner") ||
    text.includes("proxy") ||
    text.includes("mint") ||
    text.includes("blacklist") ||
    text.includes("honeypot") ||
    text.includes("tax")
  ) {
    return {
      label: "contract_risk",
      confidence: 0.84,
      reason: "contract control language detected"
    };
  }

  if (
    text.includes("how to avoid scams") ||
    text.includes("what should i check") ||
    text.includes("how do i stay safe")
  ) {
    return {
      label: "security_education",
      confidence: 0.86,
      reason: "education-style security request"
    };
  }

  return null;
}

async function classifyMention(tweetText) {
  const fast = fastRuleClassify(tweetText);
  if (fast) return fast;

  const prompt = `
You classify X mentions for a Web3 fraud prevention agent.

Return ONLY valid JSON:
{"label":"ignore|wallet_risk|contract_risk|project_dd|scam_alert|security_education","confidence":0.0,"reason":"short"}

Definitions:
- ignore = greeting, praise, nonsense, no real request
- wallet_risk = wallet drain / approvals / suspicious wallet behavior
- contract_risk = contract controls, mint, owner, proxy, blacklist, pause, honeypot
- project_dd = request to scan or assess a token/project
- scam_alert = phishing, impersonation, malicious links, mass-tag spam
- security_education = asks what to check or how to stay safe

Mention:
"${tweetText}"
`;

  try {
    const response = await openai.responses.create({
      model: "gpt-5.2",
      input: prompt
    });

    const raw = (response.output_text || "").trim();
    return JSON.parse(raw);
  } catch {
    return {
      label: "ignore",
      confidence: 0,
      reason: "classification_failed"
    };
  }
}

module.exports = { classifyMention };