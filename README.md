# 我的股票資料庫

以純 HTML、CSS 與原生 JavaScript 製作的個人股票與股息管理網站。網站部署於 GitHub Pages，使用 Firebase Authentication 的 Google 登入及 Cloud Firestore，讓同一帳號可跨裝置同步股票、排序及股息資料。

正式網址：<https://lws621022.github.io/stock-trading-journal/>

## 功能

- Google 帳號登入、登出及 Firebase local persistence
- 未登入時隱藏所有股票與股息資料
- 手動輸入股票代碼與股票名稱，不連線行情 API 驗證
- Firestore 股票新增、刪除、搜尋及最多 100 支限制
- 使用上移、下移調整自訂順序，透過 Firestore batch write 跨裝置保留
- 新增、編輯、刪除年度股息，計算指定年度及累積股息
- 股息依代碼、名稱、指定年度、累積金額或自訂順序排序
- UTF-8 BOM CSV 匯出，以及驗證、去重、分批寫入的 CSV 匯入
- 保留舊 IndexedDB／localStorage 資料的首次 Firebase 匯入工具
- 桌面、平板與手機響應式版面

網站不再取得即時或盤後行情，不包含股價、漲跌、成交量、EPS、殖利率、交易時段判斷或 15 秒自動更新，也不會請求 `/api/stocks`。

## Firestore 資料結構

資料以登入使用者 UID 隔離，既有路徑與文件欄位維持不變：

```text
users/{uid}/stocks/{stockCode}
  stockCode, stockName, sortOrder, createdAt, updatedAt

users/{uid}/stocks/{stockCode}/dividends/{year}
  year, amount, note, createdAt, updatedAt
```

Firebase 初始化位於 `firebase-config.js`，Firestore CRUD、驗證、排序與 CSV 位於 `firebase-service.js`，登入閘門位於 `auth.js`，股息介面位於 `dividends.js`。Firebase Web SDK `12.16.0` 由官方 CDN 以 ES Module 載入，不使用 npm 或建置工具。

Firebase Web API key 是前端專案識別資訊。Repository 不得加入 Google 密碼、Service Account 私鑰、OAuth Client Secret、GitHub Token 或其他真正的私密憑證。

## 檔案用途

- `index.html`：登入閘門、首頁、手動新增、股票清單及股息頁面
- `style.css`：卡片、表格、按鈕、訊息及響應式版面
- `app.js`：頁面切換、Firestore 股票 CRUD、自訂排序、本機匯入與 CSV 操作
- `dividends.js`：Firestore 股息 CRUD、計算、排序與編輯流程
- `firebase-config.js`：Firebase CDN 初始化、Authentication local persistence 與 Firestore instance
- `firebase-service.js`：Firestore 股票／股息服務、驗證、batch write 與 CSV 備份還原
- `auth.js`：Google 登入、登出、UID 顯示、登入閘門與錯誤處理
- `firestore.rules`：UID 隔離、欄位白名單、型態與 timestamp 驗證
- `db.js`：僅供舊版 IndexedDB 股票第一次匯入 Firebase
- `.github/workflows/pages.yml`：main 更新後部署純靜態網站到 GitHub Pages
- `.nojekyll`：要求 GitHub Pages 直接提供靜態檔案

`stock-api.js`、`watchlist.js`、`sample-data.js`、`worker.js`、`wrangler.jsonc` 與 `.assetsignore` 已移除。行情與 `/api/stocks` 依賴清除後，Worker 與 Wrangler 設定可安全從本 Repository 刪除；這不會刪除或停用 Cloudflare 帳號中已部署的線上 Worker。

## GitHub Pages 部署

Repository 使用 `.github/workflows/pages.yml`。每次 `main` 更新或手動觸發 workflow 時會：

1. checkout Repository。
2. 設定 GitHub Pages。
3. 將 Repository 根目錄作為純靜態 artifact 上傳。
4. 部署至 GitHub Pages environment。

第一次使用時，請到 GitHub Repository：

1. `Settings` → `Pages`。
2. 在 `Build and deployment` 將 `Source` 設為 `GitHub Actions`。
3. 確認 `Settings` → `Actions` → `General` 允許執行 Actions。
4. 合併變更至 `main` 後，到 `Actions` 查看 `Deploy static site to GitHub Pages`。
5. 完成後開啟 <https://lws621022.github.io/stock-trading-journal/>。

所有本地 CSS 與 JavaScript 均使用 `./` 相對路徑，因此可在 `/stock-trading-journal/` 子路徑載入。Firebase Authentication 的 authorized domain 只需包含 `lws621022.github.io`，不需要加入路徑。

## Firebase 與既有資料

Firestore 文件路徑只使用 Firebase Project ID、登入 UID、股票代碼及年度，不使用 `workers.dev` 網域，也不以網站來源作為使用者識別。部署網域改變不會移動或清除 Firestore 文件；在 GitHub Pages 使用同一 Google 帳號登入後，會讀取相同股票與股息資料。

IndexedDB 與 localStorage 依網域隔離，舊 `workers.dev` 網域的本機資料不會自動出現在 GitHub Pages。正式資料以 Firestore 為準，程式不會清除任何既有 Firestore 文件或舊網域本機資料。

### 發布 Firestore Security Rules

本次移轉不修改 `firestore.rules`。若尚未發布：

1. 開啟 Firebase Console 並選擇 `stock-dividend-tracker`。
2. 進入 `Firestore Database` → `規則`。
3. 貼上 Repository 根目錄 `firestore.rules` 的完整內容。
4. 按「發布」。

### Google 登入

1. Firebase Authentication 啟用 Google provider。
2. Authorized domains 包含 `lws621022.github.io`。
3. 開啟正式網址並按「使用 Google 帳號登入」。
4. 登入後頁首顯示名稱或電子郵件及 UID。
5. 重新開啟同一瀏覽器，local persistence 通常會保留登入狀態。
6. 登出後股票與股息內容會立即隱藏並清空。

## CSV 與本機資料移轉

首頁的「匯出 CSV」下載含 UTF-8 BOM 的檔案，欄位固定為：

```text
stock_code,stock_name,year,dividend,note,sort_order
```

「匯入 CSV」會驗證表頭與每列資料；相同股票代碼與年度會更新既有文件，不建立重複年度，並分批寫入 Firestore。

只有在 Firestore 尚無股票且目前 GitHub Pages 網域偵測到舊 IndexedDB／localStorage 資料時，首頁才顯示「將目前股票匯入 Firebase」。匯入不會刪除原本機資料。

## 測試

可使用本機靜態 HTTP server 測試，不要直接雙擊 `index.html`。例如：

```console
python -m http.server 8000
```

瀏覽器測試重點：

- 未登入只顯示登入區塊；Google 登入與登出正常
- 同一瀏覽器重新開啟後保留登入狀態
- 登入後可讀取既有 Firestore 股票及股息
- 手動新增 `2330 / 台積電`，重複代碼與空白名稱顯示錯誤
- 股票達 50 支時阻止新增
- 刪除確認、重新載入、搜尋及上移／下移正常
- 股息新增、編輯、刪除、年度防重複、年度與累積排序正常
- CSV 中文匯出與 CSV 匯入正常
- DevTools Network 不出現 `/api/stocks`，Console 不出現 Cloudflare 或行情錯誤
- GitHub Pages 子路徑的 `style.css`、`auth.js`、`db.js`、`dividends.js`、`app.js` 均回傳 200
- 手機寬度下股票及股息表格改為卡片且可操作
- 另一台電腦用同一 Google 帳號登入後看到相同資料與排序
