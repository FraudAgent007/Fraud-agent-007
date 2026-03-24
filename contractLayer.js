const { Interface, ZeroAddress, getAddress, id } = require("ethers");

const ERC20_META_ABI = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
]);

const OWNERSHIP_ABI = new Interface([
  "function owner() view returns (address)",
  "function getOwner() view returns (address)"
]);

const PAUSABLE_ABI = new Interface([
  "function paused() view returns (bool)"
]);

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

const TOPIC_OWNERSHIP_TRANSFERRED = id("OwnershipTransferred(address,address)");

function hexSlotToAddress(slotValue) {
  if (!slotValue || slotValue === "0x") return null;
  const hex = slotValue.replace(/^0x/, "").padStart(64, "0");
  const addr = `0x${hex.slice(24)}`;

  if (addr.toLowerCase() === ZeroAddress.toLowerCase()) return null;

  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

function hasSelectorInBytecode(bytecode, signature) {
  if (!bytecode || bytecode === "0x") return false;
  const selector = id(signature).slice(2, 10).toLowerCase();
  return bytecode.toLowerCase().includes(selector);
}

async function safeCall(rpc, to, iface, fn, args = []) {
  try {
    const data = iface.encodeFunctionData(fn, args);
    const raw = await rpc.ethCall({ to, data });
    const decoded = iface.decodeFunctionResult(fn, raw);
    return decoded?.[0] ?? null;
  } catch {
    return null;
  }
}

async function countLogs(rpc, address, topic0, blocksBack = 200000) {
  try {
    const currentHex = await rpc.blockNumber();
    const current = Number(BigInt(currentHex));
    const from = Math.max(current - blocksBack, 0);

    const logs = await rpc.getLogs({
      address,
      topics: [topic0],
      fromBlock: `0x${from.toString(16)}`,
      toBlock: "latest"
    });

    return Array.isArray(logs) ? logs.length : 0;
  } catch {
    return 0;
  }
}

async function detectProxy(rpc, address) {
  const [implRaw, adminRaw] = await Promise.all([
    rpc.getStorageAt(address, EIP1967_IMPLEMENTATION_SLOT),
    rpc.getStorageAt(address, EIP1967_ADMIN_SLOT)
  ]);

  const implementation = hexSlotToAddress(implRaw);
  const admin = hexSlotToAddress(adminRaw);

  if (implementation) {
    const implCode = await rpc.getCode(implementation);
    if (implCode && implCode !== "0x") {
      return {
        isProxy: true,
        implementation,
        admin
      };
    }
  }

  return {
    isProxy: false,
    implementation: null,
    admin: null
  };
}

function summarizeBytecodeCapabilities(bytecode) {
  return {
    mintFn:
      hasSelectorInBytecode(bytecode, "mint(address,uint256)") ||
      hasSelectorInBytecode(bytecode, "mint(uint256)"),
    blacklistFn:
      hasSelectorInBytecode(bytecode, "blacklist(address)") ||
      hasSelectorInBytecode(bytecode, "isBlacklisted(address)") ||
      hasSelectorInBytecode(bytecode, "setBlacklist(address,bool)"),
    pauseFn:
      hasSelectorInBytecode(bytecode, "pause()") ||
      hasSelectorInBytecode(bytecode, "unpause()"),
    ownerFn:
      hasSelectorInBytecode(bytecode, "owner()") ||
      hasSelectorInBytecode(bytecode, "getOwner()")
  };
}

function scoreContractRisk(base) {
  let score = 0;
  const flags = [];
  const nextChecks = [];

  if (base.proxy?.isProxy) {
    score += 20;
    flags.push("proxy_contract");
    nextChecks.push("verify upgrade authority and implementation control");
  }

  if (base.proxy?.admin) {
    score += 10;
    flags.push("proxy_admin_set");
    nextChecks.push("check whether proxy admin is a multisig or EOA");
  }

  if (base.owner) {
    score += 10;
    flags.push("owner_present");
    nextChecks.push("verify whether owner is renounced");
  }

  if (base.paused === true) {
    score += 25;
    flags.push("paused_now");
    nextChecks.push("transfers may be actively restricted");
  }

  if (base.bytecodeCaps?.mintFn) {
    score += 20;
    flags.push("mint_function_detected");
    nextChecks.push("verify whether supply can still expand");
  }

  if (base.bytecodeCaps?.blacklistFn) {
    score += 25;
    flags.push("blacklist_pattern_detected");
    nextChecks.push("verify whether addresses can be blocked");
  }

  if (base.bytecodeCaps?.pauseFn) {
    score += 15;
    flags.push("pause_pattern_detected");
    nextChecks.push("verify whether transfers can be paused");
  }

  if ((base.eventSummary?.ownershipEvents || 0) > 0) {
    flags.push("ownership_transfer_history");
  }

  let riskLevel = "low";
  if (score >= 60) riskLevel = "high";
  else if (score >= 30) riskLevel = "medium";

  return {
    riskScore: score,
    riskLevel,
    flags: [...new Set(flags)],
    nextChecks: [...new Set(nextChecks)],
    primaryRisk: flags[0] || "limited_contract_risk_signals"
  };
}

async function inspectContract({ rpc, tokenAddress }) {
  const address = getAddress(tokenAddress);
  const code = await rpc.getCode(address);

  if (!code || code === "0x") {
    return {
      found: false,
      flags: ["not_a_contract"],
      nextChecks: [],
      riskScore: 0,
      riskLevel: "unknown",
      primaryRisk: "not_a_contract"
    };
  }

  const proxy = await detectProxy(rpc, address);
  const target = proxy.isProxy ? proxy.implementation : address;
  const targetCode = proxy.isProxy ? await rpc.getCode(target) : code;

  const [name, symbol, decimals, totalSupply, ownerA, ownerB, paused, ownershipEvents] =
    await Promise.all([
      safeCall(rpc, target, ERC20_META_ABI, "name"),
      safeCall(rpc, target, ERC20_META_ABI, "symbol"),
      safeCall(rpc, target, ERC20_META_ABI, "decimals"),
      safeCall(rpc, target, ERC20_META_ABI, "totalSupply"),
      safeCall(rpc, target, OWNERSHIP_ABI, "owner"),
      safeCall(rpc, target, OWNERSHIP_ABI, "getOwner"),
      safeCall(rpc, target, PAUSABLE_ABI, "paused"),
      countLogs(rpc, target, TOPIC_OWNERSHIP_TRANSFERRED, 300000)
    ]);

  const base = {
    found: true,
    tokenAddress: address,
    targetAddress: target,
    name: typeof name === "string" ? name : null,
    symbol: typeof symbol === "string" ? symbol : null,
    decimals: decimals != null ? Number(decimals) : null,
    totalSupply: totalSupply != null ? totalSupply.toString() : null,
    owner: ownerA || ownerB || null,
    paused: paused === null ? null : Boolean(paused),
    proxy,
    bytecodeCaps: summarizeBytecodeCapabilities(targetCode),
    eventSummary: {
      ownershipEvents
    }
  };

  return {
    ...base,
    ...scoreContractRisk(base)
  };
}

module.exports = {
  inspectContract
};