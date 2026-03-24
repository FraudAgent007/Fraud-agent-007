const { Interface, id, getAddress, ZeroAddress } = require("ethers");

const ERC20_META_ABI = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const OWNERSHIP_ABI = new Interface([
  "function owner() view returns (address)",
  "function getOwner() view returns (address)",
]);

const PAUSABLE_ABI = new Interface([
  "function paused() view returns (bool)",
]);

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const TOPIC_TRANSFER = id("Transfer(address,address,uint256)");
const TOPIC_OWNERSHIP_TRANSFERRED = id("OwnershipTransferred(address,address)");
const TOPIC_ROLE_GRANTED = id("RoleGranted(bytes32,address,address)");
const TOPIC_PAUSED = id("Paused(address)");
const TOPIC_UNPAUSED = id("Unpaused(address)");

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

async function getRecentEventCount(rpc, address, topic0, blocksBack = 100_000) {
  try {
    const currentHex = await rpc.blockNumber();
    const current = Number(BigInt(currentHex));
    const from = Math.max(current - blocksBack, 0);

    const logs = await rpc.getLogs({
      address,
      topics: [topic0],
      fromBlock: `0x${from.toString(16)}`,
      toBlock: "latest",
    });

    return Array.isArray(logs) ? logs.length : 0;
  } catch {
    return 0;
  }
}

async function detectProxy(rpc, address) {
  const [implRaw, adminRaw, beaconRaw] = await Promise.all([
    rpc.getStorageAt(address, EIP1967_IMPLEMENTATION_SLOT),
    rpc.getStorageAt(address, EIP1967_ADMIN_SLOT),
    rpc.getStorageAt(address, EIP1967_BEACON_SLOT),
  ]);

  const implementation = hexSlotToAddress(implRaw);
  const admin = hexSlotToAddress(adminRaw);
  const beacon = hexSlotToAddress(beaconRaw);

  if (implementation) {
    const implCode = await rpc.getCode(implementation);
    if (implCode && implCode !== "0x") {
      return {
        isProxy: true,
        implementation,
        admin,
        beacon,
      };
    }
  }

  return {
    isProxy: false,
    implementation: null,
    admin: null,
    beacon: null,
  };
}

function summarizeBytecodeCapabilities(bytecode) {
  return {
    ownerFn:
      hasSelectorInBytecode(bytecode, "owner()") ||
      hasSelectorInBytecode(bytecode, "getOwner()"),
    pausedFn: hasSelectorInBytecode(bytecode, "paused()"),
    mintFn:
      hasSelectorInBytecode(bytecode, "mint(address,uint256)") ||
      hasSelectorInBytecode(bytecode, "mint(uint256)") ||
      hasSelectorInBytecode(bytecode, "_mint(address,uint256)"),
    blacklistFn:
      hasSelectorInBytecode(bytecode, "blacklist(address)") ||
      hasSelectorInBytecode(bytecode, "isBlacklisted(address)") ||
      hasSelectorInBytecode(bytecode, "setBlacklist(address,bool)") ||
      hasSelectorInBytecode(bytecode, "addBlacklist(address)") ||
      hasSelectorInBytecode(bytecode, "removeBlacklist(address)"),
    pauseFn:
      hasSelectorInBytecode(bytecode, "pause()") ||
      hasSelectorInBytecode(bytecode, "unpause()"),
    roleFn:
      hasSelectorInBytecode(bytecode, "grantRole(bytes32,address)") ||
      hasSelectorInBytecode(bytecode, "revokeRole(bytes32,address)") ||
      hasSelectorInBytecode(bytecode, "hasRole(bytes32,address)"),
  };
}

function scoreContractRisk(ctx) {
  let score = 0;
  const flags = [];
  const nextChecks = [];

  if (!ctx.found) {
    return {
      riskLevel: "unknown",
      riskScore: 0,
      flags,
      nextChecks,
      primaryRisk: "no_contract_data",
    };
  }

  if (ctx.proxy?.isProxy) {
    score += 20;
    flags.push("proxy_contract");
    nextChecks.push("verify upgrade authority and implementation control");
  }

  if (ctx.proxy?.admin) {
    score += 10;
    flags.push("proxy_admin_set");
    nextChecks.push("check whether proxy admin is a multisig or EOA");
  }

  if (ctx.owner && ctx.owner !== ZeroAddress) {
    score += 10;
    flags.push("has_owner");
    nextChecks.push("verify whether owner is renounced or still active");
  }

  if (ctx.paused === true) {
    score += 25;
    flags.push("paused_now");
    nextChecks.push("transfers may be actively restricted");
  }

  if (ctx.bytecodeCaps?.mintFn) {
    score += 20;
    flags.push("mint_function_detected");
    nextChecks.push("verify whether supply can still expand");
  }

  if (ctx.bytecodeCaps?.blacklistFn) {
    score += 20;
    flags.push("blacklist_pattern_detected");
    nextChecks.push("verify whether addresses can be blocked");
  }

  if (ctx.bytecodeCaps?.pauseFn || ctx.bytecodeCaps?.pausedFn) {
    score += 15;
    flags.push("pause_pattern_detected");
    nextChecks.push("verify whether transfers can be paused");
  }

  if (ctx.bytecodeCaps?.roleFn || ctx.eventSummary?.roleGrantedEvents > 0) {
    score += 15;
    flags.push("role_based_control_detected");
    nextChecks.push("verify privileged role holders");
  }

  if ((ctx.eventSummary?.ownershipEvents || 0) > 0) {
    score += 5;
    flags.push("ownership_transfer_history");
  }

  if ((ctx.eventSummary?.pausedEvents || 0) > 0) {
    score += 5;
    flags.push("pause_history_seen");
  }

  score = Math.min(score, 100);

  let riskLevel = "low";
  if (score >= 60) riskLevel = "high";
  else if (score >= 30) riskLevel = "medium";

  const primaryRisk =
    flags[0] ||
    (riskLevel === "high"
      ? "mutable_contract_control"
      : riskLevel === "medium"
        ? "privileged_contract_structure"
        : "limited_contract_risk_signals");

  return {
    riskLevel,
    riskScore: score,
    flags: [...new Set(flags)],
    nextChecks: [...new Set(nextChecks)],
    primaryRisk,
  };
}

async function inspectContract({ rpc, tokenAddress }) {
  const addr = getAddress(tokenAddress);
  const code = await rpc.getCode(addr);

  if (!code || code === "0x") {
    return {
      found: false,
      flags: ["not_a_contract"],
      nextChecks: [],
      riskLevel: "unknown",
      riskScore: 0,
      primaryRisk: "not_a_contract",
    };
  }

  const proxy = await detectProxy(rpc, addr);
  const target = proxy.isProxy ? proxy.implementation : addr;
  const targetCode = proxy.isProxy ? await rpc.getCode(target) : code;

  const [
    name,
    symbol,
    decimals,
    totalSupply,
    ownerA,
    ownerB,
    paused,
    ownershipEvents,
    roleGrantedEvents,
    pausedEvents,
    unpausedEvents,
    transferEvents,
  ] = await Promise.all([
    safeCall(rpc, target, ERC20_META_ABI, "name"),
    safeCall(rpc, target, ERC20_META_ABI, "symbol"),
    safeCall(rpc, target, ERC20_META_ABI, "decimals"),
    safeCall(rpc, target, ERC20_META_ABI, "totalSupply"),
    safeCall(rpc, target, OWNERSHIP_ABI, "owner"),
    safeCall(rpc, target, OWNERSHIP_ABI, "getOwner"),
    safeCall(rpc, target, PAUSABLE_ABI, "paused"),
    getRecentEventCount(rpc, target, TOPIC_OWNERSHIP_TRANSFERRED, 300_000),
    getRecentEventCount(rpc, target, TOPIC_ROLE_GRANTED, 300_000),
    getRecentEventCount(rpc, target, TOPIC_PAUSED, 300_000),
    getRecentEventCount(rpc, target, TOPIC_UNPAUSED, 300_000),
    getRecentEventCount(rpc, target, TOPIC_TRANSFER, 300_000),
  ]);

  const owner = ownerA || ownerB || null;
  const bytecodeCaps = summarizeBytecodeCapabilities(targetCode);

  const base = {
    found: true,
    tokenAddress: addr,
    targetAddress: target,
    chainType: "evm",
    name: typeof name === "string" ? name : null,
    symbol: typeof symbol === "string" ? symbol : null,
    decimals: decimals != null ? Number(decimals) : null,
    totalSupply: totalSupply != null ? totalSupply.toString() : null,
    owner,
    paused,
    proxy,
    bytecodeCaps,
    eventSummary: {
      ownershipEvents,
      roleGrantedEvents,
      pausedEvents,
      unpausedEvents,
      transferEvents,
    },
  };

  const scored = scoreContractRisk(base);

  return {
    ...base,
    ...scored,
  };
}

module.exports = {
  inspectContract,
};