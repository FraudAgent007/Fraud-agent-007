function normalizeText(text) {
  return (text || "")
    .toLowerCase()
    .replace(/@\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\$\w+/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplicitScanRequest(text) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("check ") ||
    t.includes("scan ") ||
    t.includes("what do you think") ||
    t.includes("thoughts on") ||
    t.includes("main risk") ||
    t.includes("look at ") ||
    t.includes("is this safe") ||
    t.includes("is this a rug") ||
    t.includes("rug?")
  );
}

function shouldReply({ tweet, classification, repliedData, state }) {
  if (!tweet || !classification) {
    return { allow: false, reason: "missing_data" };
  }

  const label = classification.label || "ignore";
  const confidence = classification.confidence || 0;
  const authorId = String(tweet.author_id || "");
  const normalized = normalizeText(tweet.text);
  const explicitScan = isExplicitScanRequest(tweet.text);
  const now = Date.now();

  if (label === "ignore") {
    return { allow: false, reason: "classified_ignore" };
  }

  if ((repliedData.tweetIds || []).includes(tweet.id)) {
    return { allow: false, reason: "already_replied_tweet" };
  }

  if ((repliedData.textHashes || []).includes(normalized)) {
    return { allow: false, reason: "duplicate_text" };
  }

  const lastReplyAt = repliedData.authorCooldowns?.[authorId] || 0;
  const cooldown = explicitScan ? 60 * 1000 : 5 * 60 * 1000;

  if (now - lastReplyAt < cooldown) {
    return { allow: false, reason: "author_cooldown" };
  }

  const recent = (state.globalReplyTimes || []).filter(
    (t) => now - t < 2 * 60 * 1000
  );

  if (recent.length >= 2 && !explicitScan && label !== "scam_alert") {
    return { allow: false, reason: "global_rate_limit" };
  }

  // 🔥 FIXED
  if (label === "scam_alert" && confidence >= 0.7) {
    return { allow: true, reason: "scam_alert_allowed" };
  }

  if (explicitScan && confidence >= 0.65) {
    return { allow: true, reason: "explicit_scan_request" };
  }

  if (
    ["contract_risk", "wallet_risk", "project_dd"].includes(label) &&
    confidence >= 0.75
  ) {
    return { allow: true, reason: "high_value_signal" };
  }

  if (label === "security_education" && confidence >= 0.6) {
    return { allow: true, reason: "education_allowed" };
  }

  return { allow: false, reason: "not_relevant" };
}

module.exports = { normalizeText, isExplicitScanRequest, shouldReply };