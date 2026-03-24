function hasExplicitScanIntent(text) {
  const t = (text || "").toLowerCase();

  return (
    t.includes("check ") ||
    t.includes("scan ") ||
    t.includes("what do you think") ||
    t.includes("thoughts on") ||
    t.includes("is this safe") ||
    t.includes("is this a rug") ||
    t.includes("safe?") ||
    t.includes("rug?") ||
    t.includes("intel on") ||
    t.includes("main risk") ||
    t.includes("look at ")
  );
}

function hasScamStyleText(text) {
  const t = (text || "").toLowerCase();

  return (
    t.includes("system update") ||
    t.includes("private signal") ||
    t.includes("fast signal") ||
    t.includes("backstage access") ||
    t.includes("exclusive") ||
    t.includes("airdrop") ||
    t.includes("claim") ||
    t.includes("wallet connect") ||
    t.includes("connect wallet") ||
    t.includes("main center") ||
    t.includes("technical core") ||
    t.includes("verified network") ||
    t.includes("check this out") ||
    t.includes("link")
  );
}

function decideResponse({
  tweetText,
  classification,
  risk,
  onchain,
  contractCtx,
  caseSummary,
  holderCtx,
}) {
  const label = classification?.label || "ignore";
  const confidence = classification?.confidence || 0;
  const explicitScan = hasExplicitScanIntent(tweetText);
  const scamStyleText = hasScamStyleText(tweetText);

  const onchainFound = !!onchain?.found;
  const weakMatch =
    onchain?.matchConfidence === "low" ||
    (onchain?.flags || []).includes("weak_token_match");

  const contractFound = !!contractCtx?.found;
  const contractScore = contractCtx?.riskScore || 0;
  const contractFlags = contractCtx?.flags || [];
  const onchainFlags = onchain?.flags || [];
  const holderFlags = holderCtx?.flags || [];

  const severeContractRisk =
    contractScore >= 60 ||
    contractFlags.includes("proxy_contract") ||
    contractFlags.includes("mint_function_detected") ||
    contractFlags.includes("blacklist_pattern_detected") ||
    contractFlags.includes("sell_block_likely") ||
    contractFlags.includes("paused_now");

  const severeOnchainRisk =
    onchainFlags.includes("honeypot_detected") ||
    onchainFlags.includes("high_sell_tax") ||
    onchainFlags.includes("buy_sell_imbalance");

  const severeHolderRisk =
    holderFlags.includes("extreme_top_holder_concentration") ||
    holderFlags.includes("top5_dominance");

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

  // IMPORTANT: scam posts should never be downgraded into "needs_contract"
  if (label === "scam_alert" || scamStyleText) {
    return {
      action: "reply",
      strategy: "hard_warning",
      reason: "scam_pattern_detected",
    };
  }

  if (explicitScan && confidence >= 0.65) {
    if (weakMatch || (!onchainFound && !contractFound)) {
      return {
        action: "reply",
        strategy: "needs_contract",
        reason: "explicit_user_request_but_weak_resolution",
      };
    }

    if (severeContractRisk || severeOnchainRisk || severeHolderRisk) {
      return {
        action: "reply",
        strategy: "hard_warning",
        reason: "explicit_user_request_with_strong_risk",
      };
    }

    return {
      action: "reply",
      strategy: "cautious_dd",
      reason: "explicit_user_request",
    };
  }

  if (confidence < 0.6) {
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

  if (severeContractRisk || severeOnchainRisk || severeHolderRisk) {
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