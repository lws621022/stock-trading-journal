// EPS 與殖利率仍為測試資料，不代表真實資訊或投資建議。
const SAMPLE_STOCKS = [
  { stockCode: "2330", currentYearEps: 18.42, previousYearEps: 39.20, dividendYield: 1.78 },
  { stockCode: "2317", currentYearEps: 5.31, previousYearEps: 11.01, dividendYield: 3.25 },
  { stockCode: "2454", currentYearEps: 28.64, previousYearEps: 66.92, dividendYield: 3.62 },
  { stockCode: "2881", currentYearEps: 4.76, previousYearEps: 10.77, dividendYield: 4.10 },
  { stockCode: "0050", currentYearEps: null, previousYearEps: null, dividendYield: 2.66 },
  { stockCode: "0056", currentYearEps: null, previousYearEps: null, dividendYield: 7.42 },
  { stockCode: "6488", currentYearEps: 10.58, previousYearEps: 31.34, dividendYield: 4.28 }
];

// 讓畫面操作程式能透過明確的唯讀資料來源取得範例資訊。
Object.freeze(SAMPLE_STOCKS);

