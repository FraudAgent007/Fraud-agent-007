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

  const existing = cases[key] || {
    key,
    firstSeen: now,
    lastSeen: now,
    timesSeen: 0,
    tokenSymbol: input.tokenSymbol || null,
    tokenAddress: input.tokenAddress || null,
    pattern: input.pattern || null,
    labels: {},
    latestRiskLevel: null,
    latestPrimaryRisk: null,
    history: [],
  };

  existing.lastSeen = now;
  existing.timesSeen += 1;

  if (input.tokenSymbol) existing.tokenSymbol = input.tokenSymbol;
  if (input.tokenAddress) existing.tokenAddress = input.tokenAddress;
  if (input.pattern) existing.pattern = input.pattern;

  if (input.label) {
    existing.labels[input.label] = (existing.labels[input.label] || 0) + 1;
  }

  if (input.riskLevel) existing.latestRiskLevel = input.riskLevel;
  if (input.primaryRisk) existing.latestPrimaryRisk = input.primaryRisk;

  existing.history.push({
    time: now,
    label: input.label || null,
    riskLevel: input.riskLevel || null,
    primaryRisk: input.primaryRisk || null,
    source: input.source || "mention",
  });

  existing.history = existing.history.slice(-25);

  cases[key] = existing;
  return existing;
}

function summarizeCase(caseEntry) {
  if (!caseEntry) {
    return {
      seenBefore: false,
      timesSeen: 0,
      latestRiskLevel: null,
      latestPrimaryRisk: null,
    };
  }

  return {
    seenBefore: caseEntry.timesSeen > 1,
    timesSeen: caseEntry.timesSeen,
    latestRiskLevel: caseEntry.latestRiskLevel || null,
    latestPrimaryRisk: caseEntry.latestPrimaryRisk || null,
  };
}

module.exports = {
  loadCases,
  saveCases,
  updateCaseMemory,
  summarizeCase,
};