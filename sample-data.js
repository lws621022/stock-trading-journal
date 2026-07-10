// 第一階段使用的測試資料，不代表真實、即時或可供投資決策的市場資訊。
const SAMPLE_STOCKS = [
  { stockCode: "2330", stockName: "台積電", market: "上市", type: "股票", currentYearEps: 18.42, previousYearEps: 39.20, dividendYield: 1.78, previousClose: 1040, latestClose: 1055, updatedAt: "2026-07-09 13:30" },
  { stockCode: "2317", stockName: "鴻海", market: "上市", type: "股票", currentYearEps: 5.31, previousYearEps: 11.01, dividendYield: 3.25, previousClose: 168.5, latestClose: 170, updatedAt: "2026-07-09 13:30" },
  { stockCode: "2454", stockName: "聯發科", market: "上市", type: "股票", currentYearEps: 28.64, previousYearEps: 66.92, dividendYield: 3.62, previousClose: 1320, latestClose: 1335, updatedAt: "2026-07-09 13:30" },
  { stockCode: "2881", stockName: "富邦金", market: "上市", type: "股票", currentYearEps: 4.76, previousYearEps: 10.77, dividendYield: 4.10, previousClose: 88.2, latestClose: 89.1, updatedAt: "2026-07-09 13:30" },
  { stockCode: "0050", stockName: "元大台灣50", market: "上市", type: "ETF", currentYearEps: null, previousYearEps: null, dividendYield: 2.66, previousClose: 189.4, latestClose: 190.1, updatedAt: "2026-07-09 13:30" },
  { stockCode: "0056", stockName: "元大高股息", market: "上市", type: "ETF", currentYearEps: null, previousYearEps: null, dividendYield: 7.42, previousClose: 36.75, latestClose: 36.92, updatedAt: "2026-07-09 13:30" },
  { stockCode: "6488", stockName: "環球晶", market: "上櫃", type: "股票", currentYearEps: 10.58, previousYearEps: 31.34, dividendYield: 4.28, previousClose: 395.5, latestClose: 401, updatedAt: "2026-07-09 13:30" }
];

// 讓畫面操作程式能透過明確的唯讀資料來源取得範例資訊。
Object.freeze(SAMPLE_STOCKS);

