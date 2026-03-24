const { LRUCache } = require("lru-cache");

const TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 12000);
const RETRIES = Number(process.env.RPC_RETRIES || 2);
const BACKOFF_BASE_MS = Number(process.env.RPC_BACKOFF_BASE_MS || 300);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return { status: res.status, json, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

class RpcPool {
  constructor(urls, options = {}) {
    this.urls = (urls || []).filter(Boolean);
    if (!this.urls.length) {
      throw new Error("RpcPool requires at least one RPC URL");
    }

    this.index = 0;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.retries = options.retries ?? RETRIES;

    this.cache = new LRUCache({
      max: 5000,
      ttl: options.cacheTtlMs ?? 30_000,
    });
  }

  nextUrl() {
    const url = this.urls[this.index % this.urls.length];
    this.index = (this.index + 1) % this.urls.length;
    return url;
  }

  async request(method, params, { cacheKey = null, ttlMs = null } = {}) {
    const key = cacheKey || `${method}:${JSON.stringify(params)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    let lastError = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const url = this.nextUrl();
      const payload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      };

      try {
        const { status, json, headers } = await postJson(
          url,
          payload,
          this.timeoutMs
        );

        if (status === 429) {
          const retryAfter = Number(headers.get("retry-after") || 0);
          const waitMs =
            (retryAfter ? retryAfter * 1000 : BACKOFF_BASE_MS * 2 ** attempt) +
            Math.random() * 200;
          await sleep(waitMs);
          lastError = new Error(`RPC rate limited: ${url}`);
          continue;
        }

        if (json?.error) {
          lastError = new Error(
            `RPC error: ${json.error.message || "unknown"}`
          );
          await sleep(BACKOFF_BASE_MS * 2 ** attempt + Math.random() * 200);
          continue;
        }

        if (status >= 200 && status < 300 && json && "result" in json) {
          if (ttlMs != null) {
            this.cache.set(key, json.result, { ttl: ttlMs });
          } else {
            this.cache.set(key, json.result);
          }
          return json.result;
        }

        lastError = new Error(`RPC HTTP ${status} from ${url}`);
      } catch (err) {
        lastError = err;
      }

      await sleep(BACKOFF_BASE_MS * 2 ** attempt + Math.random() * 200);
    }

    throw lastError || new Error("RPC request failed");
  }

  getCode(address, blockTag = "latest") {
    return this.request("eth_getCode", [address, blockTag], { ttlMs: 60_000 });
  }

  getStorageAt(address, slot, blockTag = "latest") {
    return this.request("eth_getStorageAt", [address, slot, blockTag], {
      ttlMs: 60_000,
    });
  }

  ethCall(tx, blockTag = "latest") {
    return this.request("eth_call", [tx, blockTag], { ttlMs: 5_000 });
  }

  getLogs(filter) {
    return this.request("eth_getLogs", [filter], { ttlMs: 10_000 });
  }

  blockNumber() {
    return this.request("eth_blockNumber", [], { ttlMs: 2_000 });
  }
}

module.exports = { RpcPool };