require("dotenv").config();
const fs = require("fs");
const { TwitterApi } = require("twitter-api-v2");

const { classifyMention } = require("./classifier");
const { shouldReply, normalizeText } = require("./policy");
const { generateReply } = require("./responder");
const { analyzeRisk } = require("./riskEngine");
const { updatePatternMemory, getPatternInsight } = require("./patternMemory");
const { updateSignalMemory } = require("./signalEngine");
const { shouldCreateThreatBrief, generateThreatBrief } = require("./poster");
const { fetchWatchlistSignals, mergeWatchlistSignals } = require("./watchlistEngine");
const {
  getDexContextFromText,
  getHoneypotContext,
  mapDexChainToHoneypot,
  summarizeOnchain,
} = require("./onchain");
const {
  loadRepliedData,
  saveRepliedData,
  loadState,
  saveState,
} = require("./memory");

const LOCK_FILE = "bot.lock";

if (fs.existsSync(LOCK_FILE)) {
  const lockTime = parseInt(fs.readFileSync(LOCK_FILE, "utf8"), 10);
  const now = Date.now();

  if (now - lockTime > 2 * 60 * 1000) {
    console.log("Old lock detected -> removing...");
    fs.unlinkSync(LOCK_FILE);
  } else {
    console.log("Another bot instance is already running.");
    process.exit(1);
  }
}

fs.writeFileSync(LOCK_FILE, String(Date.now()));

function cleanupAndExit() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {}
  process.exit(0);
}

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);
process.on("exit", () => {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {}
});

const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

const rwClient = client.readWrite;

let repliedData = loadRepliedData();
let state = loadState();
let isProcessing = false;
let isPosting = false;
let isWatching = false;

function isFreshTweet(tweet) {
  if (!tweet.created_at) return true;
  const created = new Date(tweet.created_at).getTime();
  return Date.now() - created <= 60 * 60 * 1000;
}

function addPostHistory(type, text) {
  state.postHistory = [
    ...(state.postHistory || []),
    { type, text, time: Date.now() },
  ].slice(-50);
}

async function safeClassify(text) {
  try {
    return await classifyMention(text);
  } catch (err) {
    console.error("Classification failed:", err.message || err);
    return { label: "ignore", confidence: 0, reason: "classification_error" };
  }
}

async function safeGenerateReply(text, label, risk, onchain) {
  try {
    return await generateReply(text, label, risk, onchain);
  } catch (err) {
    console.error("Reply generation failed:", err.message || err);
    return null;
  }
}

async function safeGenerateThreatBrief(recentSignals, summary) {
  try {
    return await generateThreatBrief(recentSignals, summary);
  } catch (err) {
    console.error("Threat brief generation failed:", err.message || err);
    return null;
  }
}

async function processMentions() {
  if (isProcessing) {
    console.log("Skipping cycle: still processing...");
    return;
  }

  isProcessing = true;

  try {
    const me = await rwClient.v2.me();
    const botUserId = me.data.id;

    console.log("Fraud Agent 007 On-chain Engine running as:", me.data.username);

    const mentions = await rwClient.v2.userMentionTimeline(botUserId, {
      max_results: 10,
      expansions: ["author_id"],
      "tweet.fields": ["author_id", "created_at"],
    });

    const tweets = (mentions.data?.data || []).slice(0, 2).reverse();

    for (const tweet of tweets) {
      console.log("\nChecking:", tweet.id);
      console.log("Text:", tweet.text);

      if (!isFreshTweet(tweet)) {
        console.log("Skip: stale_tweet");
        continue;
      }

      if (String(tweet.author_id) === String(botUserId)) {
        console.log("Skip: self_tweet");
        continue;
      }

      const classification = await safeClassify(tweet.text);
      console.log("Classification:", classification);

      const decision = shouldReply({
        tweet,
        classification,
        repliedData,
        state,
      });
      console.log("Policy:", decision);

      const pattern = updatePatternMemory(state, tweet.text);
      const insight = getPatternInsight(state, tweet.text);
      const risk = analyzeRisk(tweet.text, classification.label);
      const signal = updateSignalMemory(state, tweet, classification, risk);

      console.log("Pattern:", pattern);
      console.log("Pattern Insight:", insight);
      console.log("Risk:", risk);
      console.log("Signal:", signal);

      let onchain = {
        found: false,
        flags: [],
        nextChecks: [],
      };

      const ONCHAIN_ALLOWED = [
        "project_dd",
        "contract_risk",
        "scam_alert",
      ];

      if (ONCHAIN_ALLOWED.includes(classification.label)) {
        try {
          const dexContext = await getDexContextFromText(tweet.text);

          if (dexContext?.type === "multi_token") {
            console.log("Skip on-chain: multi-token context");
          } else if (dexContext?.type === "major_token") {
            console.log("Skip on-chain: major token");
          } else if (dexContext?.bestPair) {
            const hpChainId = mapDexChainToHoneypot(dexContext.bestPair.chainId);
            const tokenAddress = dexContext.bestPair.baseToken?.address;

            const honeypotContext =
              hpChainId && tokenAddress
                ? await getHoneypotContext(hpChainId, tokenAddress)
                : null;

            onchain = summarizeOnchain(dexContext, honeypotContext);
          } else {
            console.log("Skip on-chain: no match");
          }
        } catch (err) {
          console.error("On-chain fetch failed:", err.message || err);
        }
      } else {
        console.log("Skip on-chain: classification not relevant");
      }

      console.log("On-chain:", onchain);

      saveState(state);

      if (!decision.allow) continue;

      const enrichedText = insight
        ? `${tweet.text}\n\nPattern: ${insight}`
        : tweet.text;

      const replyText = await safeGenerateReply(
        enrichedText,
        classification.label,
        risk,
        onchain
      );

      if (!replyText) continue;

      console.log("Reply:", replyText);

      try {
        await rwClient.v2.reply(replyText, tweet.id);
        console.log("Replied:", tweet.id);
      } catch (err) {
        console.error("Reply failed:", err.message || err);
        continue;
      }

      const normalized = normalizeText(tweet.text);

      repliedData.tweetIds.push(tweet.id);
      repliedData.textHashes.push(normalized);
      repliedData.authorCooldowns[tweet.author_id] = Date.now();

      repliedData.tweetIds = repliedData.tweetIds.slice(-500);
      repliedData.textHashes = repliedData.textHashes.slice(-500);

      saveRepliedData(repliedData);

      const now = Date.now();
      state.globalReplyTimes.push(now);
      state.globalReplyTimes = state.globalReplyTimes
        .filter((t) => now - t < 24 * 60 * 60 * 1000)
        .slice(-200);

      saveState(state);

      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  } catch (err) {
    console.error("Main error:", err.message || err);
  } finally {
    isProcessing = false;
  }
}

async function processWatchlist() {
  if (isWatching) {
    console.log("Skipping cycle: still processing watchlist...");
    return;
  }

  isWatching = true;

  try {
    console.log("Scanning watchlist...");

    const signals = await fetchWatchlistSignals(
      rwClient,
      safeClassify,
      analyzeRisk
    );

    if (signals.length) {
      mergeWatchlistSignals(state, signals);
      saveState(state);
      console.log(`Watchlist signals added: ${signals.length}`);
    } else {
      console.log("No new watchlist signals.");
    }
  } catch (err) {
    console.error("Watchlist error:", err.message || err);
  } finally {
    isWatching = false;
  }
}

async function maybePostThreatBrief() {
  if (isPosting) {
    console.log("Skipping threat brief: still posting...");
    return;
  }

  isPosting = true;

  try {
    const decision = shouldCreateThreatBrief(state);
    console.log("Threat brief policy:", decision);

    if (!decision.allow) return;

    const postText = await safeGenerateThreatBrief(
      decision.recentSignals,
      decision.summary
    );

    if (!postText) return;

    const recentBriefs = (state.postHistory || [])
      .filter((p) => p.type === "threat_brief")
      .map((p) => p.text);

    if (recentBriefs.includes(postText)) {
      console.log("Threat brief skipped: duplicate post text.");
      return;
    }

    console.log("Threat brief:", postText);

    try {
      const tweet = await rwClient.v2.tweet(postText);
      console.log("Threat brief posted:", tweet.data.id);
    } catch (err) {
      console.error("Threat brief post failed:", err.message || err);
      return;
    }

    state.lastPostTime = Date.now();
    addPostHistory("threat_brief", postText);
    saveState(state);
  } catch (err) {
    console.error("Threat brief engine error:", err.message || err);
  } finally {
    isPosting = false;
  }
}

async function start() {
  while (true) {
    await processMentions();
    await processWatchlist();
    await maybePostThreatBrief();

    console.log("Waiting 60s...");
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

start();