const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateReply({
  tweetText,
  classification,
  risk,
  onchain,
  contractCtx,
  holderCtx,
  caseSummary,
  brain
}) {
  const prompt = `
You are Fraud Agent 007, a sharp Web3 fraud prevention account on X.

Write ONE reply.

Rules:
- concise
- skeptical
- credible
- no emojis
- no hashtags
- no hype
- no filler
- no financial advice
- max 220 characters
- end with "$F007"

Inputs:
classification=${classification?.label || ""}
risk_level=${risk?.riskLevel || ""}
risk_score=${risk?.score ?? ""}
onchain_found=${onchain?.found ? "true" : "false"}
token_symbol=${onchain?.tokenSymbol || ""}
liquidity_usd=${onchain?.liquidityUsd ?? ""}
contract_flags=${(contractCtx?.flags || []).join(", ")}
holder_flags=${(holderCtx?.flags || []).join(", ")}
times_seen=${caseSummary?.timesSeen ?? 0}
brain_score=${brain?.reasoning?.score ?? ""}
brain_posture=${brain?.reasoning?.posture ?? ""}
brain_reasons=${(brain?.reasoning?.reasons || []).join(", ")}
brain_gaps=${(brain?.evidence?.gaps || []).join(", ")}
strategy=${brain?.plan?.strategy || ""}

Mention:
"${tweetText}"

Return only the final reply.
`;

  try {
    const response = await openai.responses.create({
      model: "gpt-5.2",
      input: prompt
    });

    const text = (response.output_text || "").trim();
    if (text) return text;
  } catch {}

  const main = brain?.reasoning?.reasons?.[0] || "unverified structure";
  const gap = brain?.evidence?.gaps?.[0] || null;
  const strategy = brain?.plan?.strategy || "light_response";

  if (strategy === "hard_warning") {
    return `Main concern: ${main}. Verify control, transfer restrictions, and holder concentration before trusting it. $F007`;
  }

  if (strategy === "cautious_dd") {
    return `Early concern: ${main}${gap ? `; missing ${gap.replaceAll("_", " ")}` : ""}. Need contract control and holder structure before trusting it. $F007`;
  }

  if (strategy === "educational") {
    return `Security comes from structure, not hype. Compare control, upgrade rights, and validator or operator trust assumptions. $F007`;
  }

  if (strategy === "light_response") {
    return `Not enough evidence yet. Need the exact contract plus control and liquidity checks before assessing it properly. $F007`;
  }

  return null;
}

module.exports = { generateReply };