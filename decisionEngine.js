function decideResponse({ classification, risk, onchain, contractCtx, caseSummary }) {
  const label = classification?.label || "ignore";
  const confidence = classification?.confidence || 0;

  const onchainFound = !!onchain?.found;
  const weakMatch =
    onchain?.matchConfidence === "low" ||
    (onchain?.flags || []).includes("weak_token_match");

  const contractFound = !!contractCtx?.found;
  const contractFlags = contractCtx?.flags || [];
  const onchainFlags = onchain?.flags || [];

  const severeContractRisk =
    contractFlags.includes("proxy_contract") ||
    contractFlags.includes("mint_function_detected") ||
    contractFlags.includes("blacklist_pattern_detected") ||
    contractFlags.includes("sell_block_likely");

  const severeOnchainRisk =
    onchainFlags.includes("honeypot_detected") ||
    onchainFlags.includes("high_sell_tax") ||
    onchainFlags.includes("buy_sell_imbalance");

  const repeatedEntityRisk =
    caseSummary?.seenBefore &&
    (caseSummary?.latestRiskLevel === "high" || caseSummary?.latestPrimaryRisk);

  if (label === "ignore") {
    return {
      action: "skip",
      strategy: "none",
      reason: "ignore_label",
    };
  }

  if (confidence < 0.8) {
    return {
      action: "reply",
      strategy: "cautious_dd",
      reason: "low_confidence_signal",
    };
  }

  if (
    (label === "project_dd" || label === "contract_risk") &&
    !onchainFound &&
    !contractFound
  ) {
    return {
      action: "reply",
      strategy: "needs_contract",
      reason: "missing_hard_evidence",
    };
  }

  if (weakMatch) {
    return {
      action: "reply",
      strategy: "needs_contract",
      reason: "weak_token_match",
    };
  }

  if (severeContractRisk || severeOnchainRisk || label === "scam_alert") {
    return {
      action: "reply",
      strategy: "hard_warning",
      reason: "strong_risk_evidence",
    };
  }

  if (repeatedEntityRisk) {
    return {
      action: "reply",
      strategy: "hard_warning",
      reason: "repeated_entity_risk",
    };
  }

  if (label === "security_education") {
    return {
      action: "reply",
      strategy: "educational",
      reason: "education_request",
    };
  }

  return {
    action: "reply",
    strategy: "cautious_dd",
    reason: "default_structured_reply",
  };
}

module.exports = { decideResponse };