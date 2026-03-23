const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function modeInstruction(label) {
  switch (label) {
    case "wallet_risk":
      return "Focus on wallet behavior, approvals, suspicious interactions, counterparties, drain risk, and source of funds.";
    case "contract_risk":
      return "Focus on owner privileges, mint rights, blacklist risk, tax or sell restrictions, admin controls, proxy risk, and verification.";
    case "project_dd":
      return "Focus on liquidity control, holder concentration, team wallets, launch structure, tokenomics, and contract controls.";
    case "scam_alert":
      return "Focus on phishing, fake urgency, malicious links, fake support, impersonation, rugs, drains, and suspicious promotion patterns.";
    case "security_education":
      return "Focus on practical due diligence, scam avoidance, and verification steps.";
    default:
      return "Focus on Web3 risk and verification.";
  }
}

async function generateReply(tweetText, label, risk, onchain) {
  const mode = modeInstruction(label);

  const prompt = `
You are Fraud Agent 007, a high-trust Web3 fraud intelligence account on X.

Write one reply.

Rules:
- sharp
- concise
- crypto-native
- skeptical
- professional
- no hype
- no emojis
- no hashtags
- no slang
- no financial advice
- max 240 characters
- end with "$F007"

Style:
- sound like a risk desk
- no filler
- no generic warnings
- identify the strongest risk first
- say exactly what to verify next
- use on-chain context if present, but do not overclaim certainty

Mode:
${label}

Mode focus:
${mode}

Structured risk context:
risk_level=${risk.riskLevel}
risk_score=${risk.score}
red_flags=${risk.redFlags.join(", ")}
next_checks=${risk.nextChecks.join(", ")}

On-chain context:
found=${onchain?.found}
chain=${onchain?.chainId}
token_symbol=${onchain?.tokenSymbol}
liquidity_usd=${onchain?.liquidityUsd}
volume_24h=${onchain?.volume24h}
fdv=${onchain?.fdv}
market_cap=${onchain?.marketCap}
honeypot=${onchain?.honeypot}
buy_tax=${onchain?.buyTax}
sell_tax=${onchain?.sellTax}
transfer_tax=${onchain?.transferTax}
onchain_flags=${(onchain?.flags || []).join(", ")}
onchain_next_checks=${(onchain?.nextChecks || []).join(", ")}

Mention and context:
"${tweetText}"
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: prompt,
  });

  const text = (response.output_text || "").trim();

  if (!text) {
    return `Main risk is ${risk.redFlags[0] || "hidden control"}. Verify ${risk.nextChecks[0] || "liquidity and permissions"} first. $F007`;
  }

  return text;
}

module.exports = { generateReply };