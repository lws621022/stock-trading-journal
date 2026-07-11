// Cloudflare Worker 入口：處理股票 API，其餘請求交由靜態資產服務。
const OFFICIAL_SOURCES = [
  {
    market: "上市",
    url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    timeout: 8000,
    retries: 0,
    requiredFields: ["Code", "Name", "ClosingPrice", "Change", "Date"],
    normalize: (item) => normalizeStock(item.Code, item.Name, item.ClosingPrice, item.Change, item.Date, "上市")
  },
  {
    market: "上櫃",
    // 使用「上櫃股票收盤行情」；daily_close_quotes 另含大量非普通股交易資料。
    url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes",
    timeout: 12000,
    retries: 1,
    requiredFields: ["SecuritiesCompanyCode", "CompanyName", "Close", "Change", "Date"],
    normalize: (item) => normalizeStock(item.SecuritiesCompanyCode, item.CompanyName, item.Close, item.Change, item.Date, "上櫃")
  }
];

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=60"
};
const SOURCE_CACHE_DURATION = 5 * 60 * 1000;
const FINANCIAL_CACHE_DURATION = 6 * 60 * 60 * 1000;
const sourceCache = new Map();
const pendingSources = new Map();
const financialCache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/stocks" || url.pathname === "/api/stocks/") {
      return handleStocksRequest(request, url);
    }
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ success: false, message: "查無此 API 路由" }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleStocksRequest(request, requestUrl) {
  if (request.method !== "GET") {
    return jsonResponse({ success: false, message: "僅支援 GET 請求" }, 405, { Allow: "GET" });
  }

  const stockCode = requestUrl.searchParams.get("code")?.trim().toUpperCase() || "";
  const stockCodes = requestUrl.searchParams.get("codes")?.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean) || [];
  if (stockCodes.length > 50) return jsonResponse({ success: false, message: "單次最多查詢 50 檔股票" }, 400);
  try {
    const results = await Promise.allSettled(OFFICIAL_SOURCES.map((source) => fetchOfficialSource(source, SOURCE_CACHE_DURATION)));
    const data = [];
    const warnings = [];
    const failedMarkets = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") data.push(...result.value);
      else {
        failedMarkets.push(OFFICIAL_SOURCES[index].market);
        warnings.push(formatSourceWarning(OFFICIAL_SOURCES[index].market, result.reason));
        console.error(`${OFFICIAL_SOURCES[index].market}官方資料取得失敗`);
      }
    });

    if (!data.length) return jsonResponse({ success: false, message: "目前無法取得官方股票資料" }, 502);

    const requestedCodes = stockCode ? [stockCode] : stockCodes;
    const requestedSet = new Set(requestedCodes);
    const responseData = requestedCodes.length ? data.filter((stock) => requestedSet.has(stock.stockCode)) : data;
    if (stockCode && !responseData.length) {
      if (failedMarkets.length) {
        return jsonResponse({
          success: false,
          message: `${failedMarkets.join("、")}官方資料目前無法取得，請稍後再試`,
          warnings
        }, 503);
      }
      return jsonResponse({ success: false, message: "查無此股票代號" }, 404);
    }

    await enrichFinancialData(responseData, warnings, requestedCodes.length > 0);

    const body = { success: true, data: responseData };
    if (warnings.length) body.warnings = warnings;
    return jsonResponse(body, 200);
  } catch (error) {
    console.error("股票 API 發生未預期錯誤");
    return jsonResponse({ success: false, message: "目前無法取得官方股票資料" }, 500);
  }
}

async function fetchOfficialSource(source, cacheDuration) {
  const cached = sourceCache.get(source.url);
  if (cached && Date.now() - cached.time < cacheDuration) return cached.data;
  if (pendingSources.has(source.url)) return pendingSources.get(source.url);

  const request = fetchSource(source).then((data) => {
    sourceCache.set(source.url, { data, time: Date.now() });
    return data;
  }).finally(() => pendingSources.delete(source.url));
  pendingSources.set(source.url, request);
  return request;
}

async function fetchSource(source) {
  let lastError;
  for (let attempt = 0; attempt <= source.retries; attempt += 1) {
    try {
      return await fetchSourceOnce(source);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchSourceOnce(source) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), source.timeout);
  try {
    const response = await fetch(source.url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new SourceError(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new SourceError("回傳格式不是陣列");
    const sample = payload.find((item) => item && typeof item === "object");
    const missingFields = source.requiredFields.filter((field) => !sample || !(field in sample));
    if (missingFields.length) throw new SourceError(`找不到預期欄位：${missingFields.join("、")}`);
    const stocks = payload.map(source.normalize).filter((stock) => stock.stockCode && stock.stockName);
    if (!stocks.length) throw new SourceError("回傳資料沒有有效股票紀錄");
    return stocks;
  } finally {
    clearTimeout(timeoutId);
  }
}

class SourceError extends Error {}

function formatSourceWarning(market, error) {
  if (error?.name === "AbortError") return `${market}資料暫時無法取得（官方 API 請求逾時）`;
  const reason = error instanceof SourceError ? error.message : "官方 API 連線失敗";
  return `${market}資料暫時無法取得（${reason}）`;
}

async function enrichFinancialData(stocks, warnings, includeEps) {
  const yieldResults = await Promise.allSettled([
    fetchJsonWithCache("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", SOURCE_CACHE_DURATION),
    fetchJsonWithCache("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis", SOURCE_CACHE_DURATION)
  ]);
  const yieldMap = new Map();
  if (yieldResults[0].status === "fulfilled") {
    yieldResults[0].value.forEach((row) => yieldMap.set(String(row.Code), parseNumber(row.DividendYield)));
  } else warnings.push("上市殖利率資料暫時無法取得");
  if (yieldResults[1].status === "fulfilled") {
    yieldResults[1].value.forEach((row) => yieldMap.set(String(row.SecuritiesCompanyCode), parseNumber(row.YieldRatio)));
  } else warnings.push("上櫃殖利率資料暫時無法取得");

  await Promise.all(stocks.map(async (stock) => {
    stock.dividendYield = yieldMap.get(stock.stockCode) ?? null;
    stock.currentYearEps = null;
    stock.previousYearEps = null;
    stock.epsPeriod = null;
    if (stock.type === "ETF" || !includeEps) return;
    try {
      const financial = await fetchFinancialEps(stock.stockCode);
      Object.assign(stock, financial);
    } catch (error) {
      warnings.push(`${stock.stockCode} EPS 資料暫時無法取得`);
      console.error(`${stock.stockCode} EPS 資料取得失敗`);
    }
  }));
}

async function fetchFinancialEps(stockCode) {
  const cached = financialCache.get(stockCode);
  if (cached && Date.now() - cached.time < FINANCIAL_CACHE_DURATION) return cached.data;
  const currentYear = new Date().getUTCFullYear();
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.search = new URLSearchParams({
    dataset: "TaiwanStockFinancialStatements",
    data_id: stockCode,
    start_date: `${currentYear - 1}-01-01`,
    end_date: `${currentYear}-12-31`
  });
  const payload = await fetchJsonWithTimeout(url.toString());
  if (payload.status !== 200 || !Array.isArray(payload.data)) throw new Error("公開財報資料格式不正確");
  const rows = payload.data.filter((row) => row.type === "EPS" && Number.isFinite(Number(row.value)));
  const currentRows = rows.filter((row) => Number(row.date.slice(0, 4)) === currentYear);
  const previousRows = rows.filter((row) => Number(row.date.slice(0, 4)) === currentYear - 1);
  const currentYearEps = currentRows.length ? sumValues(currentRows) : null;
  const previousYearEps = previousRows.length === 4 ? sumValues(previousRows) : null;
  const latestPeriod = currentRows.map((row) => row.date).sort().at(-1) || null;
  const data = {
    currentYearEps,
    previousYearEps,
    epsPeriod: latestPeriod ? `${currentYear} Q${Math.ceil(Number(latestPeriod.slice(5, 7)) / 3)} 累積` : null
  };
  financialCache.set(stockCode, { data, time: Date.now() });
  return data;
}

function sumValues(rows) {
  return Number(rows.reduce((sum, row) => sum + Number(row.value), 0).toFixed(4));
}

async function fetchJsonWithCache(url, cacheDuration) {
  const cached = sourceCache.get(url);
  if (cached && Date.now() - cached.time < cacheDuration) return cached.data;
  if (pendingSources.has(url)) return pendingSources.get(url);
  const request = fetchJsonWithTimeout(url).then((data) => {
    sourceCache.set(url, { data, time: Date.now() });
    return data;
  }).finally(() => pendingSources.delete(url));
  pendingSources.set(url, request);
  return request;
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error("外部資料來源回應異常");
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeStock(code, name, latestValue, changeValue, dateValue, market) {
  const latestClose = parseNumber(latestValue);
  const change = parseNumber(changeValue);
  return {
    stockCode: String(code || "").trim().toUpperCase(),
    stockName: String(name || "").trim(),
    market,
    type: String(code || "").trim().startsWith("00") ? "ETF" : "股票",
    latestClose,
    previousClose: latestClose !== null && change !== null ? latestClose - change : null,
    updatedAt: formatRocDate(dateValue)
  };
}

function parseNumber(value) {
  const cleaned = String(value ?? "").trim().replace(/,/g, "").replace(/^\+/, "");
  if (!cleaned || cleaned === "--" || cleaned === "---" || cleaned === "除權" || cleaned === "除息") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRocDate(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 7) return null;
  const year = Number(digits.slice(0, 3)) + 1911;
  return `${year}-${digits.slice(3, 5)}-${digits.slice(5, 7)}`;
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...RESPONSE_HEADERS, ...extraHeaders } });
}

