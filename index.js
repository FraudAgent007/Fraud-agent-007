require("dotenv").config();

const fs = require("fs");
const http = require("http");
const { TwitterApi } = require("twitter-api-v2");

const { classifyMention } = require("./classifier");
const { shouldReply, normalizeText } = require("./policy");
const { analyzeRisk } = require("./riskEngine");
const { updatePatternMemory, getPatternInsight } = require("./patternMemory");
const { updateSignalMemory } = require("./signalEngine");
const {
  loadCases,
  saveCases,
  updateCaseMemory,
  summarizeCase
} = require("./caseMemory");
const {
  loadRepliedData,
  saveRepliedData,
  loadState,
  saveState
} = require("./memory");
const {
  getDexContextFromText,
  summarizeOnchain,
  dexChainToRpcKey
} = require("./onchain");
const { RpcPool } = require("./rpcClient");
const { inspectContract } = require("./contractLayer");
const { inspectSolanaMint } = require("./solanaLayer");
const { getTopHolders } = require("./holderProvider");
const { analyzeHolderRisk } = require("./holderLayer");
const { buildReasoningBrain } = require("./reasoningBrain");
const { generateReply } = require("./responder");
const { shouldPostThreatBrief } = require("./threatEngine");
const { generateThreatBrief } = require("./threatPoster");

const PORT = Number(process.env.PORT || 3000);
const LOCK_FILE = "bot.lock";

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Fraud Agent 007 is running");
  })
  .listen(PORT, () => {
    console.log(`Health server listening on ${PORT}`);
  });

if (fs.existsSync(LOCK_FILE)) {
  try {
    const lockTime = parseInt(fs.readFileSync(LOCK_FILE, "utf8"), 10);
    if (Date.now() - lockTime < 120000) {
      console.log("Another bot instance is already running.");
      process.exit(1);
    }
    fs.unlinkSync(LOCK_FILE);
  } catch {}
}

fs.writeFileSync(LOCK_FILE, String(Date.now()));

function cleanup() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {}
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

process.on("exit", cleanup);

const client = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET
});

const rwClient = client.readWrite;

let repliedData = loadRepliedData();
let state = loadState();
let cases = loadCases();
let isProcessing = false;
let isThreatPosting = false;

function buildRpcPoolForChain(chainId) {
  const key = dexChainToRpcKey(chainId);
  if (!key || key === "SOLANA_RPC_URLS") return null;

  const urls = (process.env[key] || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!urls.length) return null;
  return new RpcPool(urls);
}

function getSolanaRpcUrl() {
  return (process.env.SOLANA_RPC_URLS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)[0] || null;
}

async function processMentions() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const me = await rwClient.v2.me();
    const botUserId = me.data.id;

    console.log("Fraud Agent 007 running as:", me.data.username);

    const mentions = await rwClient.v2.userMentionTimeline(botUserId, {
      max_results: 10,
      since_id: state.sinceId || undefined,
      "tweet.fields": ["author_id", "created_at"]
    });

    const tweets = (mentions.data?.data || []).reverse();
    console.log("New mentions found:", tweets.length);

    if (tweets.length) {
      state.sinceId = tweets[tweets.length - 1].id;
      saveState(state);
    }

    for (const tweet of tweets) {
      console.log("\nChecking:", tweet.id);
      console.log("Text:", tweet.text);

      if (String(tweet.author_id) === String(botUserId)) {
        console.log("Skip: self_tweet");
        continue;
      }

      const classification = await classifyMention(tweet.text);
      console.log("Classification:", classification);

      const policyDecision = shouldReply({
        tweet,
        classification,
        repliedData,
        state
      });
      console.log("Policy:", policyDecision);

      const pattern = updatePatternMemory(state, tweet.text);
      const patternInsight = getPatternInsight(state, tweet.text);
      const risk = analyzeRisk(tweet.text, classification.label);

      const signal = updateSignalMemory(state, tweet, classification, risk);
      signal.pattern = pattern;

      console.log("Pattern:", pattern);
      console.log("Pattern Insight:", patternInsight);
      console.log("Risk:", risk);

      let onchain = {
        found: false,
        flags: [],
        nextChecks: []
      };

      let contractCtx = {
        found: false,
        flags: [],
        nextChecks: []
      };

      let holderCtx = {
        found: false,
        flags: [],
        nextChecks: []
      };

      const dexContext = await getDexContextFromText(tweet.text);
      onchain = summarizeOnchain(dexContext);

      if (onchain.found && onchain.chainId && onchain.tokenAddress) {
        if ((onchain.chainId || "").toLowerCase() === "solana") {
          const solanaRpcUrl = getSolanaRpcUrl();

          if (solanaRpcUrl) {
            try {
              contractCtx = await inspectSolanaMint({
                rpcUrl: solanaRpcUrl,
                mintAddress: onchain.tokenAddress
              });
            } catch (err) {
              console.error("Solana layer error:", err.message || err);
            }
          }
        } else {
          const rpc = buildRpcPoolForChain(onchain.chainId);

          if (rpc) {
            try {
              contractCtx = await inspectContract({
                rpc,
                tokenAddress: onchain.tokenAddress
              });
            } catch (err) {
              console.error("Contract error:", err.message || err);
            }
          }

          try {
            const rawHolders = await getTopHolders({
              chainId: onchain.chainId,
              tokenAddress: onchain.tokenAddress,
              limit: 20
            });

            if (rawHolders.found) {
              holderCtx = analyzeHolderRisk({
                holders: rawHolders.holders || [],
                totalSupply: contractCtx.totalSupply || null
              });

              holderCtx.source = rawHolders.source || null;
              holderCtx.providerReason = rawHolders.reason || null;
            } else {
              holderCtx = {
                found: false,
                flags: [],
                nextChecks: [],
                reason: rawHolders.reason || "holder_provider_unavailable",
                source: rawHolders.source || null
              };
            }
          } catch (err) {
            console.error("Holder error:", err.message || err);
            holderCtx = {
              found: false,
              flags: [],
              nextChecks: [],
              reason: err.message || "holder_fetch_exception"
            };
          }
        }
      }

      console.log("On-chain:", onchain);
      console.log("Contract:", contractCtx);
      console.log("Holders:", JSON.stringify(holderCtx, null, 2));

      const primaryRisk =
        contractCtx.primaryRisk ||
        holderCtx.flags?.[0] ||
        risk.redFlags?.[0] ||
        "unverified_structure";

      const caseEntry = updateCaseMemory(cases, {
        tokenSymbol: onchain.tokenSymbol || null,
        tokenAddress: onchain.tokenAddress || null,
        pattern,
        riskScore: risk.score,
        riskLevel: risk.riskLevel,
        primaryRisk
      });

      saveCases(cases);

      const caseSummary = summarizeCase(caseEntry);
      console.log("Case Memory:", caseSummary);

      const brain = buildReasoningBrain({
        classification,
        risk,
        onchain,
        contractCtx,
        holderCtx,
        caseSummary,
        policyDecision
      });

      console.log("Brain Evidence:", brain.evidence);
      console.log("Brain Reasoning:", brain.reasoning);
      console.log("Brain Plan:", brain.plan);

      saveState(state);

      if (brain.plan.action !== "reply") continue;

      const reply = await generateReply({
        tweetText: patternInsight ? `${tweet.text}\n${patternInsight}` : tweet.text,
        classification,
        risk,
        onchain,
        contractCtx,
        holderCtx,
        caseSummary,
        brain
      });

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

      repliedData.tweetIds = repliedData.tweetIds.slice(-1000);
      repliedData.textHashes = repliedData.textHashes.slice(-1000);

      saveRepliedData(repliedData);

      state.globalReplyTimes = [...(state.globalReplyTimes || []), Date.now()]
        .filter((t) => Date.now() - t < 24 * 60 * 60 * 1000)
        .slice(-500);

      saveState(state);

      await new Promise((resolve) => setTimeout(resolve, 7000));
    }
  } catch (err) {
    console.error("Main loop error:", err.message || err);
  } finally {
    isProcessing = false;
  }
}

async function maybePostThreatBrief() {
  if (isThreatPosting) return;
  isThreatPosting = true;

  try {
    const verdict = shouldPostThreatBrief(state);
    console.log("Threat Engine:", verdict);

    if (!verdict.allow) return;

    const post = await generateThreatBrief({
      summary: verdict.summary
    });

    if (!post) return;

    try {
      await rwClient.v2.tweet(post);
      console.log("Threat brief posted:", post);
      state.lastThreatPostAt = Date.now();
      saveState(state);
    } catch (err) {
      console.error("Threat post failed:", err.message || err);
    }
  } finally {
    isThreatPosting = false;
  }
}

async function start() {
  while (true) {
    await processMentions();
    await maybePostThreatBrief();
    console.log("Waiting 60s...");
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

start();