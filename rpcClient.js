class RpcPool {
  constructor(urls) {
    this.urls = (urls || []).map((x) => x.trim()).filter(Boolean);
    this.index = 0;
  }

  nextUrl() {
    if (!this.urls.length) throw new Error("No RPC URLs configured");
    const url = this.urls[this.index % this.urls.length];
    this.index = (this.index + 1) % this.urls.length;
    return url;
  }

  async call(method, params = []) {
    let lastErr = null;

    for (let i = 0; i < Math.max(1, this.urls.length); i++) {
      const url = this.nextUrl();

      try {
        const res = await fetch(url, {
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
        if (json.error) throw new Error(json.error.message || "RPC error");
        return json.result;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error("RPC failed");
  }

  blockNumber() {
    return this.call("eth_blockNumber", []);
  }

  getCode(address, tag = "latest") {
    return this.call("eth_getCode", [address, tag]);
  }

  getStorageAt(address, slot, tag = "latest") {
    return this.call("eth_getStorageAt", [address, slot, tag]);
  }

  ethCall(tx, tag = "latest") {
    return this.call("eth_call", [tx, tag]);
  }

  getLogs(filter) {
    return this.call("eth_getLogs", [filter]);
  }
}

module.exports = { RpcPool };