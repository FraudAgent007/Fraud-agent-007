const { Interface, id, getAddress, ZeroAddress } = require("ethers");

const ERC20_META_ABI = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

const OWNERSHIP_ABI = new Interface([
  "function owner() view returns (address)",
  "function getOwner() view returns (address)",
]);

const PAUSABLE_ABI = new Interface([
  "function paused() view returns (bool)",
]);

const ROLE_ABI = new Interface([
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
]);

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee117850b5d6103";
const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const TOPIC_TRANSFER = id("Transfer(address,address,uint256)");
const TOPIC_OWNERSHIP_TRANSFERRED = id(
  "OwnershipTransferred(address,address)"
);
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

async function safeCall(rpc, to, iface, fn, args = [], from = null) {
  try {
    const data = iface.encodeFunctionData(fn, args);
    const raw = await rpc.ethCall({ to, data, ...(from ? { from } : {}) });
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
    ownerFn: hasSelectorInBytecode(bytecode, "owner()"),
    getOwnerFn: hasSelectorInBytecode(bytecode, "getOwner()"),
    pausedFn: hasSelectorInBytecode(bytecode, "paused()"),
    mintFn:
      hasSelectorInBytecode(bytecode, "mint(address,uint256)") ||
      hasSelectorInBytecode(bytecode, "_mint(address,uint256)") ||
      hasSelectorInBytecode(bytecode, "mint(uint256)"),
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

async function inspectContract({ rpc, tokenAddress }) {
  const addr = getAddress(tokenAddress);
  const code = await rpc.getCode(addr);

  const empty = {
    found: false,
    flags: [],
    nextChecks: [],
  };

  if (!code || code === "0x") {
    return {
      ...empty,
      flags: ["not_a_contract"],
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
    mintEvents,
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

  const flags = [];
  const nextChecks = [];

  if (proxy.isProxy) {
    flags.push("proxy_contract");
    nextChecks.push("verify proxy admin / upgrade authority");
  }

  if (owner && owner !== ZeroAddress) {
    flags.push("has_owner");
    nextChecks.push("verify whether owner is multisig or EOA");
  }

  if (proxy.admin) {
    flags.push("proxy_admin_set");
    nextChecks.push("verify whether proxy admin can replace implementation");
  }

  if (paused === true) {
    flags.push("paused_now");
    nextChecks.push("transfers may be restricted right now");
  }

  if (bytecodeCaps.mintFn) {
    flags.push("mint_function_detected");
    nextChecks.push("verify whether supply can still expand");
  }

  if (bytecodeCaps.blacklistFn) {
    flags.push("blacklist_pattern_detected");
    nextChecks.push("verify whether addresses can be blocked");
  }

  if (bytecodeCaps.pauseFn || bytecodeCaps.pausedFn) {
    flags.push("pause_pattern_detected");
    nextChecks.push("verify whether transfers can be paused");
  }

  if (bytecodeCaps.roleFn || roleGrantedEvents > 0) {
    flags.push("role_based_control_detected");
    nextChecks.push("verify privileged role holders");
  }

  if (ownershipEvents > 0) {
    flags.push("ownership_transfer_history");
  }

  if (pausedEvents > 0 || unpausedEvents > 0) {
    flags.push("pause_history_seen");
  }

  // This means mint-like activity has occurred historically, not that minting is still enabled.
  if (mintEvents > 0) {
    flags.push("transfer_activity_seen");
  }

  return {
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
      mintEvents,
    },
    flags: [...new Set(flags)],
    nextChecks: [...new Set(nextChecks)],
  };
}

module.exports = {
  inspectContract,
};