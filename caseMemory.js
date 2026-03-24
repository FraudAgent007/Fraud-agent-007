const fs = require("fs");

const CASES_FILE = "cases.json";

function loadCases() {
  if (!fs.existsSync(CASES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CASES_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCases(cases) {
  fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2));
}

function normalize(value) {
  return (value || "").toString().trim().toLowerCase();
}

function getCaseKey({ tokenSymbol, tokenAddress, pattern }) {
  if (tokenAddress) return `address:${normalize(tokenAddress)}`;
  if (tokenSymbol) return `token:${normalize(tokenSymbol)}`;
  if (pattern) return `pattern:${normalize(pattern)}`;
  return null;
}

function updateCaseMemory(cases, input) {
  const key = getCaseKey(input);
  if (!key) return null;

  const now = Date.now();

  const entry = cases[key] || {
    key,
    firstSeen: now,
    lastSeen: now,
    timesSeen: 0,
    tokenSymbol: input.tokenSymbol || null,
    tokenAddress: input.tokenAddress || null,
    pattern: input.pattern || null,
    avgRiskScore: 0,
    lastRiskScore: 0,
    latestRiskLevel: "unknown",
    latestPrimaryRisk: null,
    history: []
  };

  entry.lastSeen = now;
  entry.timesSeen += 1;

  if (input.tokenSymbol) entry.tokenSymbol = input.tokenSymbol;
  if (input.tokenAddress) entry.tokenAddress = input.tokenAddress;
  if (input.pattern) entry.pattern = input.pattern;

  entry.lastRiskScore = Number(input.riskScore || 0);
  entry.latestRiskLevel = input.riskLevel || "unknown";
  entry.latestPrimaryRisk = input.primaryRisk || null;

  entry.history.push({
    time: now,
    riskScore: entry.lastRiskScore,
    riskLevel: entry.latestRiskLevel,
    primaryRisk: entry.latestPrimaryRisk
  });

  entry.history = entry.history.slice(-25);

  const total = entry.history.reduce((sum, h) => sum + Number(h.riskScore || 0), 0);
  entry.avgRiskScore = entry.history.length ? total / entry.history.length : 0;

  cases[key] = entry;
  return entry;
}

function summarizeCase(caseEntry) {
  if (!caseEntry) {
    return {
      seenBefore: false,
      timesSeen: 0,
      avgRiskScore: 0,
      latestRiskLevel: "unknown",
      latestPrimaryRisk: null
    };
  }

  return {
    seenBefore: caseEntry.timesSeen > 1,
    timesSeen: caseEntry.timesSeen,
    avgRiskScore: Number(caseEntry.avgRiskScore || 0),
    latestRiskLevel: caseEntry.latestRiskLevel || "unknown",
    latestPrimaryRisk: caseEntry.latestPrimaryRisk || null
  };
}

module.exports = {
  loadCases,
  saveCases,
  updateCaseMemory,
  summarizeCase
};