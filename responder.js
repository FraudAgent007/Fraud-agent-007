const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function modeInstruction(label) {
  switch (label) {
    case "wallet_risk":
      return "Focus on wallet behavior, approvals, suspicious interactions, counterparties, and drain risk.";
    case "contract_risk":
      return "Focus on owner privileges, proxy risk, mintability, blacklist risk, pause risk, and transfer restrictions.";
    case "project_dd":
      return "Focus on launch structure, liquidity control, holder concentration, team wallets, tokenomics, and contract controls.";
    case "scam_alert":
      return "Focus on phishing, impersonation, malicious links, rugs, drains, urgency traps, and suspicious promotion patterns.";
    case "security_education":
      return "Focus on practical due diligence, scam avoidance, and concrete verification steps.";
    default:
      return "Focus on Web3 risk and verification.";
  }
}

function strategyInstruction(strategy) {
  switch (strategy) {
    case "hard_warning":
      return "Use direct, sharp language. Lead with the strongest verified risk.";
    case "needs_contract":
      return "Say structure is still unverified and imply the exact contract is needed for real assessment.";
    case "educational":
      return "Be practical and checklist-driven.";
    case "cautious_dd":
    default:
      return "Be analytical and balanced. Lead with the strongest structural uncertainty.";
  }
}

async function generateReply(
  tweetText,
  label,
  risk,
  onchain,
  contractCtx,
  decision = {},
  caseSummary = {}
) {
  const mode = modeInstruction(label);
  const strategy = decision?.strategy || "cautious_dd";
  const strategyGuide = strategyInstruction(strategy);

  const prompt = `
You are Fraud Agent 007, a sharp Web3 risk desk on X.

Write one concise reply.

Global rules:
- sound like a real analyst
- concise
- skeptical
- crypto-native
- no emojis
- no hashtags
- no slang
- no hype
- no financial advice
- no generic filler
- do not overclaim certainty
- max 220 characters
- end with "$F007"

Mode:
${label}

Mode focus:
${mode}

Strategy:
${strategy}

Strategy guidance:
${strategyGuide}

Risk context:
risk_level=${risk?.riskLevel || ""}
risk_score=${risk?.score ?? ""}
red_flags=${(risk?.redFlags || []).join(", ")}
next_checks=${(risk?.nextChecks || []).join(", ")}

On-chain context:
found=${onchain?.found === true ? "true" : "false"}
match_confidence=${onchain?.matchConfidence || "unknown"}
flags=${(onchain?.flags || []).join(", ")}
next_checks=${(onchain?.nextChecks || []).join(", ")}

Contract context:
found=${contractCtx?.found === true ? "true" : "false"}
flags=${(contractCtx?.flags || []).join(", ")}
next_checks=${(contractCtx?.nextChecks || []).join(", ")}

Case memory:
seen_before=${caseSummary?.seenBefore === true ? "true" : "false"}
times_seen=${caseSummary?.timesSeen ?? 0}
latest_risk_level=${caseSummary?.latestRiskLevel || ""}
latest_primary_risk=${caseSummary?.latestPrimaryRisk || ""}

Decision reason:
${decision?.reason || ""}

Mention:
"${tweetText}"

If case memory shows this entity was seen before, use that naturally only if it improves the reply.
Write the best final reply now.
`;

  const response = await openai.responses.create({
    model: "gpt-5.2",
    input: prompt,
  });

  const text = (response.output_text || "").trim();

  if (!text) {
    if (strategy === "needs_contract") {
      return "Main risk is still unverified structure. Share the exact contract, then verify owner control, LP custody, and transfer restrictions. $F007";
    }

    if (strategy === "hard_warning") {
      return "Main risk is mutable control, not narrative. Verify owner privileges, proxy authority, and transfer restrictions before trusting it. $F007";
    }

    if (strategy === "educational") {
      return "Security is mostly about structure, not brand. Verify control, upgrade rights, and holder concentration before trusting any setup. $F007";
    }

    return "Main risk is unverified structure. Verify contract control, liquidity ownership, and holder concentration before trusting it. $F007";
  }

  return text;
}

module.exports = { generateReply };