async function getTopHolders(chainId, tokenAddress, limit = 20) {
  // SIMPLE SAFE VERSION (no API yet)
  // prevents crash and lets bot run

  return {
    found: false,
    flags: [],
    nextChecks: [],
    reason: "holder_layer_not_connected_yet",
  };
}

module.exports = { getTopHolders };