# 我的股票資料庫

一個個人使用的台股資料管理網頁，以純 HTML、CSS 與原生 JavaScript 製作。網站使用 Firebase Google 登入及 Firestore 同步使用者的股票與股息資料；既有 Cloudflare Worker 繼續提供官方盤後與即時行情 API。

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
- 登入後使用 Firestore 保存已加入的股票，避免重複加入並支援跨裝置同步
- 依股票代號由小到大排序
- 依股票代號或股票名稱即時搜尋
- 顯示真實 EPS、官方殖利率、盤後收盤價與資料日期
- 支援刪除單筆、重新載入及清除全部股票
- 桌面與手機響應式版面；手機表格可水平捲動
- 不重新載入頁面即可切換首頁、新增股票及個股資料
- 使用 Firestore 保存最多 50 支自選股與自訂順序，支援新增、刪除、代碼與漲跌幅排序
- 即時看盤於台灣時間平日 09:00～13:30 每 15 秒更新；離開頁面、背景分頁及非交易時間停止輪詢
- 單一行情失敗時保留上次成功資料，並在畫面顯示更新失敗
- 股息紀錄直接整合既有 IndexedDB 股票與即時看盤自選股，可新增、編輯、確認後刪除歷年每股股息
- 支援指定年度、累積股息與股票資料排序；上移、下移的自訂順序重新整理後仍保留

## 檔案用途

- `index.html`：首頁、新增股票頁與個股資料頁的 HTML 結構
- `style.css`：卡片、表格、按鈕、訊息及響應式版面樣式
- `sample-data.js`：相容舊版載入順序的空資料檔，不再含假 EPS 或殖利率
- `stock-api.js`：官方上市、上櫃盤後資料查詢、格式整理與記憶體快取
- `watchlist.js`：自選股 localStorage、即時行情、排序、錯誤處理與自動更新生命週期
- `dividends.js`：讀寫 Firestore 股息子集合、計算加總、排序及編輯流程
- `firebase-config.js`：Firebase CDN 初始化、Authentication persistence 與 Firestore instance
- `firebase-service.js`：Firestore 股票／股息 CRUD、驗證、batch write 與 CSV 備份還原
- `auth.js`：Google 登入、登出、UID 顯示、登入閘門與繁體中文錯誤處理
- `firestore.rules`：使用者 UID 隔離、欄位白名單、型態與 timestamp 驗證
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

看到 HTTP 200 且 JSON 包含 `"success": true` 與股票資料，即代表 Function 已啟用。網站中也應能重新載入官方收盤資料；登入後，重新整理頁面仍會從 Firestore 載入已加入的股票。

即時看盤另應確認 2330、2317、0050 可新增且重新整理後仍存在；重複代號與無效代號會顯示錯誤；刪除後重新整理不會復原。手機寬度下每檔股票會改為卡片，交易時段可觀察 15 秒更新、立即更新及背景分頁暫停行為。

股息紀錄可使用已加入的 2330 台積電、2317 鴻海與 2454 聯發科測試：

- 為同一股票新增 2023、2024、2025 年不同金額，確認最近年度與累積股息自動更新
- 編輯任一年度，再刪除一筆並確認刪除提示
- 再次輸入相同年度，確認系統詢問是否更新且不建立重複資料
- 依指定年度與累積股息高低排序，沒有指定年度資料的股票應排在最後
- 使用上移、下移調整自訂順序，重新整理後確認資料和順序仍存在
- 將瀏覽器縮至 720px 以下，確認股票清單與歷年紀錄改為卡片

## 部署到 Cloudflare Workers

1. `wrangler.jsonc` 的 `main` 指向 `worker.js`；`assets.directory` 指向 Repository 根目錄，靜態網站會與 Worker 一起部署。
2. `assets.run_worker_first` 只讓 `/api/*` 優先進入 Worker；HTML、CSS 與 JavaScript 等其他路徑由 Workers Static Assets 直接提供。
3. 登入 Cloudflare 後，在 Repository 根目錄執行 `npx wrangler deploy`。
4. 部署完成後開啟 `https://你的-worker.workers.dev/api/stocks?code=2330`。若回傳成功 JSON，而不是 HTML 或 404，即代表 Worker API 已啟用。
5. 開啟 `https://你的-worker.workers.dev/`，確認原本的靜態網站仍能正常顯示及操作。

## 本機資料與 Firestore 注意事項

登入後的股票、排序與股息以 Firestore 為唯一正式資料來源。既有 IndexedDB 與 `stock-trading-journal-watchlist-v1` localStorage 僅供第一次匯入；匯入完成後不會自動刪除，方便使用者自行確認或備份。舊版股息 localStorage 也不會被程式自動刪除。

即時行情仍只在畫面記憶體中更新，不寫入 Firestore；第一版只依台灣時間的星期與 09:00～13:30 判斷交易時段，不另外判斷國定假日。

## Firebase 登入與雲端資料

前端以 Firebase Web SDK `12.16.0` 的 CDN ES Module 載入，不需要 npm、Vite 或其他建置工具。Firebase 初始化集中在 `firebase-config.js`；Google 登入流程在 `auth.js`；Firestore、驗證、CSV 與批次寫入集中在 `firebase-service.js`。

Firebase Web API key 是可公開的專案識別資訊。Repository 不得加入 Google 密碼、Service Account 私鑰、OAuth Client Secret、GitHub Token 或其他真正的私密憑證。

登入後的資料路徑：

```text
users/{uid}/stocks/{stockCode}
users/{uid}/stocks/{stockCode}/dividends/{year}
```

股票文件只包含：

```text
stockCode, stockName, sortOrder, createdAt, updatedAt
```

股息文件只包含：

```text
year, amount, note, createdAt, updatedAt
```

股息文件 ID 直接使用年度字串。同一股票同一年度只會有一筆；手動上移、下移會使用 Firestore batch write 更新全部 `sortOrder`。

### 發布 Firestore Security Rules

Repository 根目錄的 `firestore.rules` 是可直接發布的完整規則。操作步驟：

1. 開啟 Firebase Console。
2. 選擇 `stock-dividend-tracker`。
3. 進入「Firestore Database」→「規則」。
4. 將 `firestore.rules` 全部內容貼入編輯器。
5. 按「發布」。

規則要求登入、限制使用者只能存取自己的 UID 路徑、驗證文件欄位／型態／數值範圍與 timestamp，並禁止額外欄位。未發布規則前，前端可能顯示 `permission-denied`。

### Google 登入與取得 UID

1. 確認 Firebase Authentication 已啟用 Google provider。
2. 確認 `lws621022.github.io` 已加入 Authorized domains。
3. 開啟網站並按「使用 Google 帳號登入」。
4. 登入後，頁首會顯示名稱、電子郵件及 UID。
5. 重新開啟同一瀏覽器，local persistence 通常會保留登入狀態。
6. 按「登出」後，股票、行情與股息畫面會立即隱藏並清空。

若要限制成指定 UID，將 `auth.js` 的 `ALLOWED_UID` 填入頁首顯示的 UID，並將 `firestore.rules` 的 `ownsUser` 增加相同 UID 判斷後重新發布。前端限制只改善介面；真正的安全邊界仍以 Firestore Rules 為準。

### 匯入既有本機股票

第一次登入且 Firestore 沒有股票時，首頁會檢查：

- IndexedDB `my-taiwan-stock-database / stocks`
- localStorage `stock-trading-journal-watchlist-v1`
- localStorage `stock-trading-journal-dividends-v1` 中的有效歷史股息

若找到使用者自行加入的股票，會顯示「將目前股票匯入 Firebase」。確認後以股票代碼、股息年度去重，顯示成功、略過及失敗筆數；原 IndexedDB 與 localStorage 不會刪除。空的 `sample-data.js` 不會被匯入。

### CSV 備份與還原

首頁的「匯出 CSV」會下載 UTF-8 BOM 檔案，欄位固定為：

```text
stock_code,stock_name,year,dividend,note,sort_order
```

「匯入 CSV」會先檢查欄位與每列資料，確認後才寫入。相同股票代碼與年度會更新原文件，不會建立重複年度；資料以每批最多 400 次寫入自動分批，並顯示新增、更新、略過與錯誤筆數。

### GitHub Pages

Firebase 檔案都是瀏覽器原生 ES Module，可直接由 GitHub Pages 提供，不需要建置步驟。推送／合併後仍依既有 GitHub Pages 設定發布至 `https://lws621022.github.io/`。Repository 同時保留 `worker.js` 與 `wrangler.jsonc`，因原本的股票查詢及即時行情仍依賴 `/api/stocks`；Firebase 不取代行情 API。

### Firebase 人工驗收

實際 Firebase 專案與 Google 彈出視窗需在部署網域人工確認：

- 未登入只顯示登入區塊
- Google 登入、取消、彈出視窗封鎖、未授權網域與登出
- 重新開啟瀏覽器後的登入 persistence
- 新增／刪除股票及跨裝置同步
- 即時行情與 15 秒交易時段更新
- 股息新增、編輯、刪除、同年度防重複與重新載入
- 指定年度、累積股息與自訂順序
- CSV 中文匯出及分批匯入
- 未登入與其他 UID 的 Firestore Rules 拒絕測試
- 桌面、平板與手機版面
