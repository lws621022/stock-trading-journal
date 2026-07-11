// 官方盤後資料存取集中於此；不含金鑰，也不使用第三方 CORS 代理。
const StockAPI = (() => {
  const CACHE_DURATION = 5 * 60 * 1000;
  const SOURCES = [
    {
      market: "上市",
      url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
      normalize: (item) => normalizeRecord(item.Code, item.Name, item.ClosingPrice, item.Change, item.Date, "上市")
    },
    {
      market: "上櫃",
      url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
      normalize: (item) => normalizeRecord(item.SecuritiesCompanyCode, item.CompanyName, item.Close, item.Change, item.Date, "上櫃")
    }
  ];
  let cache = null;
  let cacheTime = 0;
  let pendingRequest = null;

  function parseNumber(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(String(value).replace(/,/g, "").replace(/^\+/, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatRocDate(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length !== 7) return value || null;
    const year = Number(digits.slice(0, 3)) + 1911;
    return `${year}-${digits.slice(3, 5)}-${digits.slice(5, 7)}`;
  }

  function normalizeRecord(code, name, closeValue, changeValue, date, market) {
    const latestClose = parseNumber(closeValue);
    const change = parseNumber(changeValue);
    return {
      stockCode: String(code || "").trim().toUpperCase(),
      stockName: String(name || "").trim(),
      market,
      type: String(code || "").startsWith("00") ? "ETF" : "股票",
      latestClose,
      previousClose: latestClose !== null && change !== null ? latestClose - change : null,
      updatedAt: formatRocDate(date)
    };
  }

  async function fetchMarket(source) {
    const response = await fetch(source.url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${source.market}資料來源回應 ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error(`${source.market}資料格式不正確`);
    return payload.map(source.normalize).filter((item) => item.stockCode && item.stockName);
  }

  async function fetchAll(force = false) {
    const now = Date.now();
    if (!force && cache && now - cacheTime < CACHE_DURATION) return cache;
    if (!force && pendingRequest) return pendingRequest;

    pendingRequest = Promise.allSettled(SOURCES.map(fetchMarket)).then((results) => {
      const records = [];
      const failedMarkets = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") records.push(...result.value);
        else { failedMarkets.push(SOURCES[index].market); console.warn(result.reason); }
      });
      if (!records.length) throw new Error("目前無法連線至官方股票資料來源");
      cache = { records, failedMarkets };
      cacheTime = Date.now();
      return cache;
    }).finally(() => { pendingRequest = null; });
    return pendingRequest;
  }

  async function findStock(stockCode, force = false) {
    const result = await fetchAll(force);
    return { stock: result.records.find((item) => item.stockCode === stockCode) || null, failedMarkets: result.failedMarkets };
  }

  async function getStocks(stockCodes, force = false) {
    const result = await fetchAll(force);
    const wanted = new Set(stockCodes);
    return { stocks: result.records.filter((item) => wanted.has(item.stockCode)), failedMarkets: result.failedMarkets };
  }

  return Object.freeze({ findStock, getStocks });
})();

