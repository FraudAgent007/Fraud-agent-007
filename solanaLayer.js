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

async function solanaRpcCall(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    })
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || "Solana RPC error");
  }
  return json.result;
}

function pct(part, total) {
  if (!total || total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

function scoreSolanaRisk(ctx) {
  let riskScore = 0;
  const flags = [];
  const nextChecks = [];

  if (ctx.mintAuthorityPresent) {
    riskScore += 22;
    flags.push("sol_mint_authority_present");
    nextChecks.push("verify whether mint authority is expected or revoked");
  }

  if (ctx.freezeAuthorityPresent) {
    riskScore += 28;
    flags.push("sol_freeze_authority_present");
    nextChecks.push("verify whether token accounts can still be frozen");
  }

  if (ctx.top1Pct >= 20) {
    riskScore += 12;
    flags.push("sol_single_holder_heavy");
    nextChecks.push("inspect the largest token account and related wallets");
  }

  if (ctx.top5Pct >= 50) {
    riskScore += 20;
    flags.push("sol_top5_dominance");
    nextChecks.push("review whether top holders can control effective float");
  }

  if (ctx.top10Pct >= 70) {
    riskScore += 24;
    flags.push("sol_extreme_top10_concentration");
    nextChecks.push("assess whether supply distribution is too tight");
  }

  let riskLevel = "low";
  if (riskScore >= 55) riskLevel = "high";
  else if (riskScore >= 28) riskLevel = "medium";

  return {
    riskScore,
    riskLevel,
    flags,
    nextChecks,
    primaryRisk: flags[0] || "limited_solana_risk_signals"
  };
}

async function inspectSolanaMint({ rpcUrl, mintAddress }) {
  const [accountInfo, tokenSupply, largestAccounts] = await Promise.all([
    solanaRpcCall(rpcUrl, "getAccountInfo", [
      mintAddress,
      {
        encoding: "jsonParsed",
        commitment: "finalized"
      }
    ]),
    solanaRpcCall(rpcUrl, "getTokenSupply", [
      mintAddress,
      {
        commitment: "finalized"
      }
    ]),
    solanaRpcCall(rpcUrl, "getTokenLargestAccounts", [
      mintAddress,
      {
        commitment: "finalized"
      }
    ])
  ]);

  const parsed = accountInfo?.value?.data?.parsed || null;
  const info = parsed?.info || {};

  const mintAuthority = info.mintAuthority || null;
  const freezeAuthority = info.freezeAuthority || null;
  const decimals =
    tokenSupply?.value?.decimals ??
    (typeof info.decimals === "number" ? info.decimals : null);

  const supplyRaw = tokenSupply?.value?.amount
    ? String(tokenSupply.value.amount)
    : (info.supply ? String(info.supply) : null);

  const supply = safeBigInt(supplyRaw);

  const largest = Array.isArray(largestAccounts?.value)
    ? largestAccounts.value.map((row) => ({
        address: row.address,
        amountRaw: String(row.amount || "0"),
        uiAmount: row.uiAmount,
        uiAmountString: row.uiAmountString,
        decimals: row.decimals
      }))
    : [];

  const balances = largest
    .map((x) => safeBigInt(x.amountRaw))
    .filter((x) => x > 0n)
    .sort((a, b) => (a > b ? -1 : 1));

  const top1 = balances.slice(0, 1).reduce((a, b) => a + b, 0n);
  const top5 = balances.slice(0, 5).reduce((a, b) => a + b, 0n);
  const top10 = balances.slice(0, 10).reduce((a, b) => a + b, 0n);

  const base = {
    found: true,
    chainType: "solana",
    mintAddress,
    mintAuthority,
    freezeAuthority,
    mintAuthorityPresent: !!mintAuthority,
    freezeAuthorityPresent: !!freezeAuthority,
    decimals,
    totalSupply: supplyRaw,
    largestAccounts: largest,
    top1Pct: pct(top1, supply),
    top5Pct: pct(top5, supply),
    top10Pct: pct(top10, supply)
  };

  return {
    ...base,
    ...scoreSolanaRisk(base)
  };
}

module.exports = {
  inspectSolanaMint
};