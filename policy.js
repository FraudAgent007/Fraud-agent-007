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

function shouldReply({ tweet, classification, repliedData, state }) {
  if (!tweet || !classification) {
    return { allow: false, reason: "missing_data" };
  }

  const label = classification.label || "";
  const confidence = classification.confidence || 0;
  const authorId = String(tweet.author_id || "");
  const normalized = normalizeText(tweet.text);
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

  // TEMP TEST MODE: 5 min per-user cooldown
  const lastUserReply = repliedData.authorCooldowns?.[authorId] || 0;
  if (now - lastUserReply < 5 * 60 * 1000) {
    return { allow: false, reason: "author_cooldown" };
  }

  // Global cooldown: 2 min between replies
  const recentGlobalReplies = (state.globalReplyTimes || []).filter(
    (ts) => now - ts < 2 * 60 * 1000
  );
  if (recentGlobalReplies.length >= 1) {
    return { allow: false, reason: "global_rate_limit" };
  }

  if (
    label === "scam_alert" ||
    label === "contract_risk" ||
    label === "wallet_risk" ||
    label === "project_dd"
  ) {
    if (confidence >= 0.82) {
      return { allow: true, reason: "high_value_signal" };
    }
    return { allow: false, reason: "confidence_too_low" };
  }

  if (label === "security_education" && confidence >= 0.88) {
    return { allow: true, reason: "education_allowed" };
  }

  return { allow: false, reason: "not_relevant" };
}

module.exports = { shouldReply, normalizeText };