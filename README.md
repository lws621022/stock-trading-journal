# 我的股票資料庫

一個個人使用的台股資料管理網頁，以純 HTML、CSS 與原生 JavaScript 製作，部署為含靜態資產的 Cloudflare Worker。使用者可以查詢官方盤後股票資料、加入個股資料、搜尋、刪除單筆資料或清除全部資料，不需要登入或雲端資料庫。

## 第二階段資料來源

股票代號與名稱取自官方公開盤後清單；最近兩個交易日的收盤價則逐檔查詢官方個股日成交資料：上市股票使用證交所 `STOCK_DAY`，上櫃股票使用櫃買中心 `afterTrading/tradingStock`。兩者皆免金鑰，並由 Worker 伺服器端呼叫。

「最新交易日收盤價」直接取個股日成交資料中最新實際交易日的收盤價；「前一交易日收盤價」直接取再前一個實際交易日的收盤價，不再以最新價減漲跌價差反推。`updatedAt` 是最新收盤價所屬的實際交易日期。若當月資料不足兩筆，Worker 會自動再查前一個月。這些資料不是盤中即時價，通常於每個交易日收盤後由資料提供單位更新。

官方最新交易日期早於台北當日日期時，API 會在 `warnings` 顯示「官方資料目前最新日期為 YYYY-MM-DD」。一般查詢在前端與 Worker 各快取五分鐘；按「重新載入資料」會加入唯一的 `refresh` 參數、使用 `no-store`，並略過 Worker 的行情、殖利率與 EPS 記憶體快取。

### Cloudflare Worker API

官方端點未提供跨來源 CORS 回應標頭，因此由 `worker.js` 在 Cloudflare 伺服器端取得並整合官方資料。Worker 入口直接處理同網域 `/api/stocks`，前端不再直接連線證交所或櫃買中心，也不使用第三方 CORS Proxy 或秘密金鑰。

自選股即時看盤沿用相同的 `/api/stocks` 路由，使用 `realtime=1` 切換即時模式。Worker 先由既有官方上市、上櫃清單確認市場別，再以證交所基本市況報導系統批次取得成交價、昨收、開高低、成交量與行情時間；每批最多 20 檔，前端單次最多傳入 50 檔，不需要 API 金鑰。

Function 只接受 GET，設定合理的官方請求逾時與五分鐘快取。其中一個市場失敗時仍回傳另一市場；兩個來源都失敗時回傳安全的繁體中文錯誤。單一股票的歷史行情失敗不影響其他股票，該股票的股價與日期顯示「—」。

### EPS 與殖利率

- 本年度累積 EPS：Worker 使用 FinMind `TaiwanStockFinancialStatements` 公開財報資料集的各季單季基本 EPS，加總本年度已公布且不重複的季度。這不是把半年或前三季累積值再次相加。
- 前一年度 EPS：加總上一完整會計年度四個季度的基本 EPS；若四季資料不完整則顯示「—」。
- 現金殖利率：上市股票取自證交所 `BWIBBU_ALL` 的 `DividendYield`；上櫃股票取自櫃買中心 `tpex_mainboard_peratio_analysis` 的 `YieldRatio`。兩者均是官方盤後資料。
- ETF：EPS 固定顯示「—」；殖利率僅在官方資料提供可靠數值時顯示。

財務資料只由 Worker 伺服器端取得。單一來源或單一股票 EPS 失敗時，對應欄位顯示「—」並回傳警告，不影響收盤價及其他股票。官方行情與殖利率在 Worker 記憶體快取五分鐘；EPS 快取六小時；前端另快取五分鐘。

為避免大量外部請求，完整 `/api/stocks` 清單不逐檔查詢 EPS；前端列表使用 `/api/stocks?codes=2330,2317,...` 批次傳入已收藏代號，單次最多 50 檔，Worker 只補齊這些股票的財務資料。

## 功能

- 優先依股票代號查詢官方上市、上櫃盤後資料，確認後加入收藏
- 使用 IndexedDB 保存已加入的股票，避免重複加入
- 依股票代號由小到大排序
- 依股票代號或股票名稱即時搜尋
- 顯示真實 EPS、官方殖利率、盤後收盤價與資料日期
- 支援刪除單筆、重新載入及清除全部股票
- 桌面與手機響應式版面；手機表格可水平捲動
- 不重新載入頁面即可切換首頁、新增股票及個股資料
- 使用 localStorage 保存最多 50 支自選股，支援新增、刪除、原始順序、代碼與漲跌幅排序
- 即時看盤於台灣時間平日 09:00～13:30 每 15 秒更新；離開頁面、背景分頁及非交易時間停止輪詢
- 單一行情失敗時保留上次成功資料，並在畫面顯示更新失敗

## 檔案用途

- `index.html`：首頁、新增股票頁與個股資料頁的 HTML 結構
- `style.css`：卡片、表格、按鈕、訊息及響應式版面樣式
- `sample-data.js`：相容舊版載入順序的空資料檔，不再含假 EPS 或殖利率
- `stock-api.js`：官方上市、上櫃盤後資料查詢、格式整理與記憶體快取
- `watchlist.js`：自選股 localStorage、即時行情、排序、錯誤處理與自動更新生命週期
- `worker.js`：Cloudflare Worker 入口，處理 `/api/stocks` 並整合兩個官方來源
- `wrangler.jsonc`：Worker、workers.dev 與靜態資產部署設定
- `.assetsignore`：排除不應作為公開靜態資產上傳的伺服器端與開發檔案
- `db.js`：IndexedDB 開啟、建表、新增、讀取、查詢、刪除及清除操作
- `app.js`：頁面切換、新增流程、列表、搜尋、排序、刪除與提示訊息
- `README.md`：專案與測試、部署說明

## 本機測試

由於網站使用 IndexedDB 與 Worker API，請勿直接雙擊 `index.html`。請安裝 Node.js 後在 Repository 根目錄執行：

```console
npx wrangler dev
```

依 Wrangler 終端顯示的本機網址開啟網站，並測試：

- `/api/stocks?code=2330`
- `/api/stocks?code=0050`
- `/api/stocks?code=8928`
- `/api/stocks?codes=2330,0050,8928&refresh=1`（略過 Worker 快取）
- `/api/stocks?code=9999`（應回傳 404）
- `/api/stocks?realtime=1&codes=2330,2317,0050`（批次即時行情）

看到 HTTP 200 且 JSON 包含 `"success": true` 與股票資料，即代表 Function 已啟用。網站中也應能重新載入官方收盤資料；重新整理頁面後，IndexedDB 中已加入的股票仍會存在。

即時看盤另應確認 2330、2317、0050 可新增且重新整理後仍存在；重複代號與無效代號會顯示錯誤；刪除後重新整理不會復原。手機寬度下每檔股票會改為卡片，交易時段可觀察 15 秒更新、立即更新及背景分頁暫停行為。

## 部署到 Cloudflare Workers

1. `wrangler.jsonc` 的 `main` 指向 `worker.js`；`assets.directory` 指向 Repository 根目錄，靜態網站會與 Worker 一起部署。
2. `assets.run_worker_first` 只讓 `/api/*` 優先進入 Worker；HTML、CSS 與 JavaScript 等其他路徑由 Workers Static Assets 直接提供。
3. 登入 Cloudflare 後，在 Repository 根目錄執行 `npx wrangler deploy`。
4. 部署完成後開啟 `https://你的-worker.workers.dev/api/stocks?code=2330`。若回傳成功 JSON，而不是 HTML 或 404，即代表 Worker API 已啟用。
5. 開啟 `https://你的-worker.workers.dev/`，確認原本的靜態網站仍能正常顯示及操作。

## IndexedDB 注意事項

加入的股票只儲存在目前瀏覽器、目前裝置及目前網站網域的 IndexedDB 中，不會同步到其他瀏覽器或裝置。無痕模式可能不會長期保留資料；清除瀏覽器網站資料、重設瀏覽器或移除該網站的儲存空間，都可能造成資料遺失。

自選股只儲存在 localStorage，不包含登入或跨裝置同步；交易紀錄仍沿用原有 IndexedDB。第一版只依台灣時間的星期與 09:00～13:30 判斷交易時段，不另外判斷國定假日。

