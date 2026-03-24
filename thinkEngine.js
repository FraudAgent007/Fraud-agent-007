function think({ signal, risk, contract, holder, memory }) {
  let conviction = 0;
  let urgency = "low";
  const reasons = [];

  if (signal?.label === "project_dd") {
    conviction += 35;
    reasons.push("explicit due diligence request");
  }

  if (signal?.label === "scam_alert") {
    conviction += 45;
    urgency = "high";
    reasons.push("scam-like structure detected");
  }

  if (signal?.label === "security_education") {
    conviction += 20;
    reasons.push("security education request");
  }

  if (risk?.riskLevel === "medium") {
    conviction += 15;
    reasons.push("medium baseline risk");
  }

  if (risk?.riskLevel === "high") {
    conviction += 30;
    urgency = "high";
    reasons.push("high baseline risk");
  }

  if (contract?.flags?.includes("proxy_contract")) {
    conviction += 20;
    reasons.push("proxy structure detected");
  }

  if (contract?.flags?.includes("mint_function_detected")) {
    conviction += 20;
    reasons.push("mint function detected");
  }

  if (contract?.flags?.includes("blacklist_pattern_detected")) {
    conviction += 30;
    urgency = "high";
    reasons.push("blacklist logic detected");
  }

  if (holder?.flags?.includes("top5_dominance")) {
    conviction += 20;
    reasons.push("top holders control supply");
  }

  if ((memory?.timesSeen || 0) >= 2) {
    conviction += 10;
    reasons.push("repeat mentions");
  }

  let strategy = "ignore";

  if (conviction >= 80) strategy = "hard_warning";
  else if (conviction >= 50) strategy = "cautious_dd";
  else if (conviction >= 25) strategy = "light_response";

  return { conviction, urgency, strategy, reasons };
}

module.exports = { think };