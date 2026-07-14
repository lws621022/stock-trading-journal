// 前端只呼叫同網域 Cloudflare Worker，避免直接連線官方來源造成 CORS 問題。
const StockAPI = (() => {
  const CACHE_DURATION = 5 * 60 * 1000;
  let cache = null;
  let cacheTime = 0;
  let pendingRequest = null;
  const stockCache = new Map();
  const pendingStockRequests = new Map();
  const listCache = new Map();
  const pendingLists = new Map();
  const pendingQuoteRequests = new Map();

  async function fetchAll(force = false) {
    const now = Date.now();
    if (!force && cache && now - cacheTime < CACHE_DURATION) return cache;
    if (!force && pendingRequest) return pendingRequest;

    const url = force ? `/api/stocks?refresh=${Date.now()}` : "/api/stocks";
    pendingRequest = fetch(url, { cache: force ? "no-store" : "default" }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
        throw new Error(payload?.message || "目前無法取得官方股票資料");
      }
      cache = { records: payload.data, warnings: payload.warnings || [] };
      cacheTime = Date.now();
      return cache;
    }).finally(() => { pendingRequest = null; });
    return pendingRequest;
  }

  async function findStock(stockCode, force = false) {
    if (!force && cache && Date.now() - cacheTime < CACHE_DURATION) {
      return { stock: cache.records.find((item) => item.stockCode === stockCode) || null, warnings: cache.warnings };
    }
    const cachedStock = stockCache.get(stockCode);
    if (!force && cachedStock && Date.now() - cachedStock.time < CACHE_DURATION) return cachedStock.value;
    if (!force && pendingStockRequests.has(stockCode)) return pendingStockRequests.get(stockCode);

    const refresh = force ? `&refresh=${Date.now()}` : "";
    const request = fetch(`/api/stocks?code=${encodeURIComponent(stockCode)}${refresh}`, { cache: force ? "no-store" : "default" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (response.status === 404) return { stock: null, warnings: [] };
        if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.message || "目前無法取得官方股票資料");
        return { stock: payload.data[0] || null, warnings: payload.warnings || [] };
      })
      .then((value) => { stockCache.set(stockCode, { value, time: Date.now() }); return value; })
      .finally(() => pendingStockRequests.delete(stockCode));
    pendingStockRequests.set(stockCode, request);
    return request;
  }

  async function getStocks(stockCodes, force = false) {
    const normalizedCodes = [...new Set(stockCodes)].sort();
    const key = normalizedCodes.join(",");
    const cached = listCache.get(key);
    if (!force && cached && Date.now() - cached.time < CACHE_DURATION) return cached.value;
    if (!force && pendingLists.has(key)) return pendingLists.get(key);

    const refresh = force ? `&refresh=${Date.now()}` : "";
    const request = fetch(`/api/stocks?codes=${encodeURIComponent(key)}${refresh}`, { cache: force ? "no-store" : "default" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success || !Array.isArray(payload.data)) throw new Error(payload?.message || "目前無法取得官方股票資料");
        return { stocks: payload.data, warnings: payload.warnings || [] };
      })
      .then((value) => { listCache.set(key, { value, time: Date.now() }); return value; })
      .finally(() => pendingLists.delete(key));
    pendingLists.set(key, request);
    return request;
  }

  // 即時看盤沿用 /api/stocks，以單次批次請求取得最多 50 檔行情。
  async function getQuotes(stockCodes, force = false) {
    const normalizedCodes = [...new Set(stockCodes.map((code) => String(code).trim().toUpperCase()))].filter(Boolean);
    if (!normalizedCodes.length) return { stocks: [], failedCodes: [], warnings: [] };
    const key = normalizedCodes.join(",");
    if (pendingQuoteRequests.has(key)) return pendingQuoteRequests.get(key);

    const refresh = force ? `&refresh=${Date.now()}` : "";
    const request = fetch(`/api/stocks?realtime=1&codes=${encodeURIComponent(key)}${refresh}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
          const error = new Error(payload?.message || "目前無法取得即時行情");
          error.failedCodes = payload?.failedCodes || normalizedCodes;
          throw error;
        }
        return {
          stocks: payload.data,
          failedCodes: Array.isArray(payload.failedCodes) ? payload.failedCodes : [],
          warnings: Array.isArray(payload.warnings) ? payload.warnings : []
        };
      })
      .finally(() => pendingQuoteRequests.delete(key));
    pendingQuoteRequests.set(key, request);
    return request;
  }

  return Object.freeze({ findStock, getStocks, getQuotes });
})();

