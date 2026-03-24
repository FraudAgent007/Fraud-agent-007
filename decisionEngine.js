function decideResponse({ policyDecision, thinkResult, onchain }) {
  if (!policyDecision?.allow) {
    return {
      action: "ignore",
      reason: policyDecision?.reason || "policy_block"
    };
  }

  if (!thinkResult || thinkResult.strategy === "ignore") {
    return {
      action: "ignore",
      reason: "low_conviction"
    };
  }

  if (!onchain?.found && thinkResult.strategy === "hard_warning") {
    return {
      action: "reply",
      strategy: "cautious_dd",
      reason: "high_concern_without_resolution"
    };
  }

  return {
    action: "reply",
    strategy: thinkResult.strategy,
    reason: "planned_from_think_engine"
  };
}

module.exports = { decideResponse };