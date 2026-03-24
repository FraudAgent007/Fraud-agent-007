require("dotenv").config();
const fs = require("fs");
const { TwitterApi } = require("twitter-api-v2");

const { classifyMention } = require("./classifier");
const { shouldReply, normalizeText } = require("./policy");
const { generateReply } = require("./responder");
const { analyzeRisk } = require("./riskEngine");
const { updatePatternMemory, getPatternInsight } = require("./patternMemory");
const { updateSignalMemory } = require("./signalEngine");
const { RpcPool } = require("./rpcClient");
const { inspectContract } = require("./contractLayer");
const { detectSellBlock } = require("./honeypot");
const { decideResponse } = require("./decisionEngine");
const {
  getDexContextFromText,
  getHoneypotContext,
  mapDexChainToHoneypot,
  summarizeOnchain,
} = require("./onchain");
const {
  loadCases,
  saveCases,
  updateCaseMemory,
  summarizeCase,
} = require("./caseMemory");
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
let cases = loadCases();
let isProcessing = false;

function isFreshTweet(tweet) {
  if (!tweet.created_at) return true;
  const created = new Date(tweet.created_at).getTime();
  return Date.now() - created <= 60 * 60 * 1000;
}

function getRpcForDexChain(chainId) {
  switch ((chainId || "").toLowerCase()) {
    case "ethereum":
      return process.env.ETH_RPC_URL || null;
    case "bsc":
      return process.env.BSC_RPC_URL || null;
    case "polygon":
      return process.env.POLYGON_RPC_URL || null;
    case "base":
      return process.env.BASE_RPC_URL || null;
    case "arbitrum":
      return process.env.ARBITRUM_RPC_URL || null;
    case "avalanche":
      return process.env.AVALANCHE_RPC_URL || null;
    default:
      return null;
  }
}

async function safeClassify(text) {
  try {
    return await classifyMention(text);
  } catch (err) {
    console.error("Classification failed:", err.message || err);
    return { label: "ignore", confidence: 0, reason: "classification_error" };
  }
}

async function safeGenerateReply(
  text,
  label,
  risk,
  onchain,
  contractCtx,
  decision,
  caseSummary
) {
  try {
    return await generateReply(
      text,
      label,
      risk,
      onchain,
      contractCtx,
      decision,
      caseSummary
    );
  } catch (err) {
    console.error("Reply generation failed:", err.message || err);
    return null;
  }
}

async function processMentions() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const me = await rwClient.v2.me();
    const botUserId = me.data.id;

    console.log("Fraud Agent 007 Memory Brain running as:", me.data.username);

    const mentions = await rwClient.v2.userMentionTimeline(botUserId, {
      max_results: 10,
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

      const policyDecision = shouldReply({
        tweet,
        classification,
        repliedData,
        state,
      });
      console.log("Policy:", policyDecision);

      const pattern = updatePatternMemory(state, tweet.text);
      const insight = getPatternInsight(state, tweet.text);
      const risk = analyzeRisk(tweet.text, classification.label);
      const signal = updateSignalMemory(state, tweet, classification, risk);

      console.log("Pattern:", pattern);
      console.log("Pattern Insight:", insight);
      console.log("Signal:", signal);
      console.log("Risk:", risk);

      let onchain = {
        found: false,
        flags: [],
        nextChecks: [],
      };

      let contractCtx = {
        found: false,
        flags: [],
        nextChecks: [],
      };

      const ONCHAIN_ALLOWED = ["project_dd", "contract_risk", "scam_alert"];

      if (ONCHAIN_ALLOWED.includes(classification.label)) {
        try {
          const dexContext = await getDexContextFromText(tweet.text);

          if (dexContext?.type === "multi_token") {
            console.log("Skip on-chain: multi-token");
          } else if (dexContext?.type === "major_token") {
            console.log("Skip on-chain: major token");
          } else if (dexContext?.bestPair) {
            if (dexContext.matchConfidence === "low") {
              console.log("Skip on-chain: weak match");
            } else {
              const hpChainId = mapDexChainToHoneypot(dexContext.bestPair.chainId);
              const tokenAddress = dexContext.bestPair.baseToken?.address;

              const honeypotContext =
                hpChainId && tokenAddress
                  ? await getHoneypotContext(hpChainId, tokenAddress)
                  : null;

              onchain = summarizeOnchain(dexContext, honeypotContext);

              const rpcUrl = getRpcForDexChain(dexContext.bestPair.chainId);

              if (rpcUrl && tokenAddress) {
                const rpc = new RpcPool([rpcUrl]);

                contractCtx = await inspectContract({
                  rpc,
                  tokenAddress,
                });

                const probeHolder =
                  contractCtx?.owner && contractCtx.owner !== null
                    ? contractCtx.owner
                    : null;

                if (probeHolder) {
                  const sellProbe = await detectSellBlock({
                    rpc,
                    dexChainId: dexContext.bestPair.chainId,
                    tokenAddress,
                    candidateHolder: probeHolder,
                  });

                  if (sellProbe?.sellBlockedLikely === true) {
                    contractCtx.flags.push("sell_block_likely");
                    contractCtx.nextChecks.push(
                      "transfers to the pool appear blocked for the probe holder"
                    );
                  }
                }

                contractCtx.flags = [...new Set(contractCtx.flags || [])];
                contractCtx.nextChecks = [
                  ...new Set(contractCtx.nextChecks || []),
                ];
              } else {
                console.log("Skip contract brain: missing RPC URL for chain");
              }
            }
          } else {
            console.log("Skip on-chain: no match");
          }
        } catch (err) {
          console.error("On-chain/contract error:", err.message || err);
        }
      } else {
        console.log("Skip on-chain: not relevant");
      }

      console.log("On-chain:", onchain);
      console.log("Contract:", contractCtx);

      const primaryRisk =
        contractCtx?.flags?.[0] ||
        onchain?.flags?.[0] ||
        risk?.redFlags?.[0] ||
        "unverified_structure";

      const caseEntry = updateCaseMemory(cases, {
        tokenSymbol: onchain?.tokenSymbol || null,
        tokenAddress: onchain?.tokenAddress || null,
        pattern,
        label: classification.label,
        riskLevel: risk?.riskLevel || "unknown",
        primaryRisk,
        source: "mention",
      });

      saveCases(cases);

      const caseSummary = summarizeCase(caseEntry);
      console.log("Case Memory:", caseSummary);

      const decision = decideResponse({
        classification,
        risk,
        onchain,
        contractCtx,
        caseSummary,
      });
      console.log("Decision Engine:", decision);

      saveState(state);

      if (!policyDecision.allow) continue;
      if (decision.action !== "reply") continue;

      const enrichedText = insight
        ? `${tweet.text}\nPattern: ${insight}`
        : tweet.text;

      const reply = await safeGenerateReply(
        enrichedText,
        classification.label,
        risk,
        onchain,
        contractCtx,
        decision,
        caseSummary
      );

      if (!reply) continue;

      console.log("Reply:", reply);

      try {
        await rwClient.v2.reply(reply, tweet.id);
        console.log("Replied:", tweet.id);
      } catch (err) {
        console.error("Reply failed:", err.message || err);
        continue;
      }

      repliedData.tweetIds.push(tweet.id);
      repliedData.textHashes.push(normalizeText(tweet.text));
      repliedData.authorCooldowns[tweet.author_id] = Date.now();

      repliedData.tweetIds = repliedData.tweetIds.slice(-500);
      repliedData.textHashes = repliedData.textHashes.slice(-500);

      saveRepliedData(repliedData);

      const now = Date.now();
      state.globalReplyTimes = [...(state.globalReplyTimes || []), now]
        .filter((t) => now - t < 24 * 60 * 60 * 1000)
        .slice(-200);

      saveState(state);

      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  } catch (err) {
    console.error("Main loop error:", err.message || err);
  } finally {
    isProcessing = false;
  }
}

async function start() {
  while (true) {
    await processMentions();
    console.log("Waiting 60s...");
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

start();