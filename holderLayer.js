function safeBigInt(value) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.floor(value));
    if (typeof value === "string" && value.trim() !== "") return BigInt(value);
    return 0n;
  } catch {
    return 0n;
  }
}

function pct(part, total) {
  if (!total || total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

function normalizeKnownInfra(address) {
  return (address || "").toLowerCase();
}

function isLikelyBurnAddress(address) {
  const a = normalizeKnownInfra(address);
  return (
    a === "0x0000000000000000000000000000000000000000" ||
    a === "0x000000000000000000000000000000000000dead"
  );
}

function isLikelyLpOrInfraHolder(holder) {
  const address = normalizeKnownInfra(holder?.address || "");
  const type = (holder?.addressType || "").toUpperCase();

  if (!address) return false;
  if (isLikelyBurnAddress(address)) return true;
  if (type === "C") return true;

  return false;
}

function summarizeConcentration(balances, totalSupply) {
  const top1 = balances.slice(0, 1).reduce((a, b) => a + b, 0n);
  const top5 = balances.slice(0, 5).reduce((a, b) => a + b, 0n);
  const top10 = balances.slice(0, 10).reduce((a, b) => a + b, 0n);

  return {
    top1Pct: pct(top1, totalSupply),
    top5Pct: pct(top5, totalSupply),
    top10Pct: pct(top10, totalSupply)
  };
}

function computeHHI(balances, totalSupply) {
  if (!totalSupply || totalSupply <= 0n || !balances.length) return 0;

  let hhi = 0;
  for (const bal of balances) {
    const share = Number((bal * 10000n) / totalSupply) / 10000;
    hhi += share * share;
  }

  return Number(hhi.toFixed(4));
}

function analyzeHolderRisk({ holders = [], totalSupply = null }) {
  if (!Array.isArray(holders) || !holders.length || !totalSupply) {
    return {
      found: false,
      flags: [],
      nextChecks: [],
      reason: "holder_data_unavailable",
      holdersConsidered: 0
    };
  }

  const supply = safeBigInt(totalSupply);
  if (supply <= 0n) {
    return {
      found: false,
      flags: [],
      nextChecks: [],
      reason: "invalid_total_supply",
      holdersConsidered: 0
    };
  }

  const cleaned = holders
    .filter((h) => h && h.address)
    .map((h) => ({
      address: String(h.address || "").toLowerCase(),
      balance: safeBigInt(h.balance),
      addressType: h.addressType || null,
      source: h.source || null,
      excludedAsInfra: isLikelyLpOrInfraHolder(h)
    }));

  const investable = cleaned.filter((h) => !h.excludedAsInfra && h.balance > 0n);
  const investableBalances = investable
    .map((h) => h.balance)
    .sort((a, b) => (a > b ? -1 : 1));

  if (!investableBalances.length) {
    return {
      found: false,
      flags: [],
      nextChecks: [],
      reason: "no_noninfra_holders",
      holdersConsidered: 0
    };
  }

  const sumObserved = investableBalances.reduce((a, b) => a + b, 0n);
  const effectiveDenominator = sumObserved > supply ? sumObserved : supply;

  const concentration = summarizeConcentration(investableBalances, effectiveDenominator);
  const hhi = computeHHI(investableBalances, effectiveDenominator);

  const flags = [];
  const nextChecks = [];
  let riskScore = 0;

  if (concentration.top1Pct >= 20) {
    flags.push("single_holder_heavy");
    nextChecks.push("inspect top wallet identity and links to team or treasury");
    riskScore += 15;
  }

  if (concentration.top5Pct >= 50) {
    flags.push("top5_dominance");
    nextChecks.push("review whether top 5 wallets can control market structure");
    riskScore += 22;
  }

  if (concentration.top10Pct >= 70) {
    flags.push("extreme_top10_concentration");
    nextChecks.push("assess whether effective float is too small for healthy price discovery");
    riskScore += 28;
  }

  if (concentration.top10Pct >= 85) {
    flags.push("low_float_risk");
    nextChecks.push("treat circulating tradable supply as potentially much lower than headline supply");
    riskScore += 18;
  }

  if (hhi >= 0.15) {
    flags.push("holder_cluster_risk");
    nextChecks.push("check whether major wallets appear coordinated or operationally related");
    riskScore += 12;
  }

  const riskLevel =
    riskScore >= 55 ? "high" :
    riskScore >= 28 ? "medium" :
    "low";

  return {
    found: true,
    riskScore,
    riskLevel,
    top1Pct: concentration.top1Pct,
    top5Pct: concentration.top5Pct,
    top10Pct: concentration.top10Pct,
    hhi,
    holdersConsidered: investable.length,
    excludedInfraCount: cleaned.filter((h) => h.excludedAsInfra).length,
    flags: [...new Set(flags)],
    nextChecks: [...new Set(nextChecks)],
    reason: null
  };
}

module.exports = {
  analyzeHolderRisk
};