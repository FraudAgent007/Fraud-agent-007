async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function getExplorerConfig(chainId) {
  switch ((chainId || "").toLowerCase()) {
    case "ethereum":
      return {
        baseUrl: "https://api.etherscan.io/v2/api",
        chainid: "1",
        apiKey: process.env.ETHERSCAN_API_KEY || ""
      };
    case "bsc":
      return {
        baseUrl: "https://api.etherscan.io/v2/api",
        chainid: "56",
        apiKey: process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || ""
      };
    case "base":
      return {
        baseUrl: "https://api.etherscan.io/v2/api",
        chainid: "8453",
        apiKey: process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || ""
      };
    case "arbitrum":
      return {
        baseUrl: "https://api.etherscan.io/v2/api",
        chainid: "42161",
        apiKey: process.env.ARBISCAN_API_KEY || process.env.ETHERSCAN_API_KEY || ""
      };
    case "polygon":
      return {
        baseUrl: "https://api.etherscan.io/v2/api",
        chainid: "137",
        apiKey: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || ""
      };
    default:
      return null;
  }
}

function normalizeAddress(addr) {
  return (addr || "").toLowerCase();
}

function normalizeExplorerHolderRow(row) {
  return {
    address: normalizeAddress(row?.TokenHolderAddress || ""),
    balance: String(row?.TokenHolderQuantity || "0"),
    addressType: row?.TokenHolderAddressType || null,
    source: "etherscan_v2"
  };
}

async function getTopHoldersFromExplorer({ chainId, tokenAddress, limit = 20 }) {
  const cfg = getExplorerConfig(chainId);

  if (!cfg || !cfg.apiKey) {
    return {
      found: false,
      holders: [],
      source: "etherscan_v2",
      reason: "missing_explorer_api_key"
    };
  }

  const url =
    `${cfg.baseUrl}?chainid=${encodeURIComponent(cfg.chainid)}` +
    `&module=token&action=topholders` +
    `&contractaddress=${encodeURIComponent(tokenAddress)}` +
    `&offset=${encodeURIComponent(limit)}` +
    `&apikey=${encodeURIComponent(cfg.apiKey)}`;

  try {
    const json = await fetchJson(url);

    if (json?.status !== "1" || !Array.isArray(json?.result)) {
      return {
        found: false,
        holders: [],
        source: "etherscan_v2",
        reason: json?.message || "no_holder_result"
      };
    }

    return {
      found: true,
      holders: json.result.map(normalizeExplorerHolderRow),
      source: "etherscan_v2",
      reason: null
    };
  } catch (err) {
    return {
      found: false,
      holders: [],
      source: "etherscan_v2",
      reason: err.message || "holder_fetch_failed"
    };
  }
}

async function getTopHolders({ chainId, tokenAddress, limit = 20 }) {
  return await getTopHoldersFromExplorer({
    chainId,
    tokenAddress,
    limit
  });
}

module.exports = {
  getTopHolders
};