function analyzeHolderRisk({ holders = [], totalSupply = null }) {
  if (!holders.length || !totalSupply) {
    return {
      found: false,
      flags: [],
      nextChecks: [],
      reason: "holder_layer_not_connected_yet"
    };
  }

  const supply = BigInt(totalSupply);
  const balances = holders
    .map((h) => BigInt(h.balance))
    .filter((b) => b > 0n)
    .sort((a, b) => (a > b ? -1 : 1));

  const top5 = balances.slice(0, 5).reduce((a, b) => a + b, 0n);
  const top10 = balances.slice(0, 10).reduce((a, b) => a + b, 0n);

  const pct = (part) => Number((part * 10000n) / supply) / 100;

  const top5Pct = pct(top5);
  const top10Pct = pct(top10);

  const flags = [];
  const nextChecks = [];

  if (top5Pct >= 50) {
    flags.push("top5_dominance");
    nextChecks.push("review top 5 wallets and related entities");
  }

  if (top10Pct >= 70) {
    flags.push("extreme_top10_concentration");
    nextChecks.push("assess whether supply is tightly controlled");
  }

  return {
    found: true,
    top5Pct,
    top10Pct,
    flags,
    nextChecks
  };
}

async function getTopHolders() {
  return {
    found: false,
    flags: [],
    nextChecks: [],
    reason: "holder_layer_not_connected_yet",
    holders: []
  };
}

module.exports = {
  getTopHolders,
  analyzeHolderRisk
};