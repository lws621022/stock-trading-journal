// Cloudflare Worker 入口：處理股票 API，其餘請求交由靜態資產服務。
const OFFICIAL_SOURCES = [
  {
    market: "上市",
    url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    normalize: (item) => normalizeStock(item.Code, item.Name, item.ClosingPrice, item.Change, item.Date, "上市")
  },
  {
    market: "上櫃",
    url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    normalize: (item) => normalizeStock(item.SecuritiesCompanyCode, item.CompanyName, item.Close, item.Change, item.Date, "上櫃")
  }
];

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=60"
};

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
  try {
    const results = await Promise.allSettled(OFFICIAL_SOURCES.map(fetchOfficialSource));
    const data = [];
    const warnings = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") data.push(...result.value);
      else {
        warnings.push(`${OFFICIAL_SOURCES[index].market}資料暫時無法取得`);
        console.error(`${OFFICIAL_SOURCES[index].market}官方資料取得失敗`);
      }
    });

    if (!data.length) return jsonResponse({ success: false, message: "目前無法取得官方股票資料" }, 502);

    const responseData = stockCode ? data.filter((stock) => stock.stockCode === stockCode) : data;
    if (stockCode && !responseData.length) {
      return jsonResponse({ success: false, message: "查無此股票代號" }, 404);
    }

    const body = { success: true, data: responseData };
    if (warnings.length) body.warnings = warnings;
    return jsonResponse(body, 200);
  } catch (error) {
    console.error("股票 API 發生未預期錯誤");
    return jsonResponse({ success: false, message: "目前無法取得官方股票資料" }, 500);
  }
}

async function fetchOfficialSource(source) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(source.url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error("官方資料來源回應異常");
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("官方資料格式不正確");
    return payload.map(source.normalize).filter((stock) => stock.stockCode && stock.stockName);
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

