function unique(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function summarizeEvidence({ classification, risk, onchain, contractCtx, holderCtx, caseSummary }) {
  const facts = [];
  const gaps = [];
  const concerns = [];

  if (classification?.label) {
    facts.push(`label:${classification.label}`);
  }

  if (risk?.riskLevel) {
    facts.push(`risk:${risk.riskLevel}`);
  }

  if (onchain?.found) {
    facts.push(`resolved:${onchain.tokenSymbol || onchain.tokenAddress || "token"}`);
    if (onchain.chainId) facts.push(`chain:${onchain.chainId}`);
    if (Number(onchain.liquidityUsd || 0) > 0) {
      facts.push(`liquidity:${Math.round(Number(onchain.liquidityUsd))}`);
    }
  } else {
    gaps.push("token_not_resolved");
  }

  for (const flag of contractCtx?.flags || []) {
    concerns.push(flag);
  }

  for (const flag of holderCtx?.flags || []) {
    concerns.push(flag);
  }

  for (const flag of risk?.redFlags || []) {
    concerns.push(flag);
  }

  if (!contractCtx?.found && classification?.label !== "security_education") {
    gaps.push("contract_not_verified");
  }

  if (!holderCtx?.found && classification?.label === "project_dd") {
    gaps.push("holder_distribution_missing");
  }

  if ((caseSummary?.timesSeen || 0) >= 2) {
    facts.push(`seen:${caseSummary.timesSeen}`);
  }

  return {
    facts: unique(facts),
    concerns: unique(concerns),
    gaps: unique(gaps)
  };
}

function scoreReasoning({ classification, risk, onchain, contractCtx, holderCtx, caseSummary }) {
  let score = 0;
  const reasons = [];
  let posture = "neutral";

  const label = classification?.label || "ignore";

  if (label === "scam_alert") {
    score += 40;
    posture = "warning";
    reasons.push("scam pattern detected");
  }

  if (label === "project_dd") {
    score += 25;
    reasons.push("explicit due diligence request");
  }

  if (label === "contract_risk") {
    score += 28;
    reasons.push("contract risk request");
  }

  if (label === "wallet_risk") {
    score += 24;
    reasons.push("wallet risk request");
  }

  if (label === "security_education") {
    score += 18;
    posture = "educational";
    reasons.push("security education request");
  }

  if (risk?.riskLevel === "medium") {
    score += 15;
    reasons.push("medium baseline risk");
  }

  if (risk?.riskLevel === "high") {
    score += 30;
    posture = "warning";
    reasons.push("high baseline risk");
  }

  if (onchain?.found) {
    score += 8;
    reasons.push("token resolved onchain");
  }

  if (!onchain?.found && ["project_dd", "contract_risk"].includes(label)) {
    score -= 8;
    reasons.push("resolution still weak");
  }

  const contractFlags = contractCtx?.flags || [];
  const holderFlags = holderCtx?.flags || [];

  if (contractFlags.includes("proxy_contract")) {
    score += 18;
    posture = "warning";
    reasons.push("proxy contract");
  }

  if (contractFlags.includes("proxy_admin_set")) {
    score += 10;
    reasons.push("proxy admin present");
  }

  if (contractFlags.includes("mint_function_detected")) {
    score += 16;
    reasons.push("mint capability");
  }

  if (contractFlags.includes("blacklist_pattern_detected")) {
    score += 28;
    posture = "warning";
    reasons.push("blacklist capability");
  }

  if (contractFlags.includes("paused_now")) {
    score += 30;
    posture = "warning";
    reasons.push("transfers may be restricted now");
  }

  if (contractFlags.includes("pause_pattern_detected")) {
    score += 16;
    reasons.push("pause capability");
  }

  if (holderFlags.includes("top5_dominance")) {
    score += 18;
    reasons.push("top 5 concentration");
  }

  if (holderFlags.includes("extreme_top10_concentration")) {
    score += 24;
    posture = "warning";
    reasons.push("extreme holder concentration");
  }

  if ((caseSummary?.timesSeen || 0) >= 2) {
    score += 8;
    reasons.push("repeat mentions");
  }

  if ((caseSummary?.avgRiskScore || 0) >= 40) {
    score += 10;
    reasons.push("historically elevated risk");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    posture,
    reasons: unique(reasons)
  };
}

function chooseAction({ policyDecision, reasoning, evidence }) {
  if (!policyDecision?.allow) {
    return {
      action: "ignore",
      strategy: "none",
      reason: policyDecision?.reason || "policy_block"
    };
  }

  const score = reasoning?.score || 0;
  const posture = reasoning?.posture || "neutral";
  const gaps = evidence?.gaps || [];

  if (score >= 75) {
    return {
      action: "reply",
      strategy: "hard_warning",
      reason: posture === "warning" ? "high_conviction_warning" : "high_conviction"
    };
  }

  if (score >= 50) {
    if (gaps.includes("contract_not_verified") || gaps.includes("holder_distribution_missing")) {
      return {
        action: "reply",
        strategy: "cautious_dd",
        reason: "moderate_conviction_with_gaps"
      };
    }

    return {
      action: "reply",
      strategy: "cautious_dd",
      reason: "moderate_conviction"
    };
  }

  if (score >= 25) {
    return {
      action: "reply",
      strategy: posture === "educational" ? "educational" : "light_response",
      reason: "light_but_actionable"
    };
  }

  return {
    action: "ignore",
    strategy: "none",
    reason: "low_conviction"
  };
}

function buildReasoningBrain(input) {
  const evidence = summarizeEvidence(input);
  const reasoning = scoreReasoning(input);
  const plan = chooseAction({
    policyDecision: input.policyDecision,
    reasoning,
    evidence
  });

  return {
    evidence,
    reasoning,
    plan
  };
}

module.exports = {
  buildReasoningBrain
};