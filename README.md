# 我的股票資料庫

一個個人使用的台股資料管理網頁，以純 HTML、CSS 與原生 JavaScript 製作，可部署至 Cloudflare Pages。使用者可以查詢內建的範例股票、加入個股資料、搜尋、刪除單筆資料或清除全部資料，不需要登入或雲端資料庫。

## 第二階段資料來源

股票代號、名稱、收盤價與資料日期優先取自官方公開盤後資料：上市股票使用[臺灣證券交易所 OpenAPI](https://openapi.twse.com.tw/)，上櫃股票使用[證券櫃檯買賣中心 OpenAPI](https://www.tpex.org.tw/openapi/)。兩者皆免金鑰。

「最新交易日收盤價」是官方資料中最近交易日的盤後收盤價；「前一交易日收盤價」由最新收盤價扣除官方提供的當日漲跌價差計算。資料日期是該筆盤後資料的交易日。這些資料不是盤中即時價，通常於每個交易日收盤後由資料提供單位更新；網站使用五分鐘記憶體快取，按「重新載入資料」會略過快取重新取得。

### Cloudflare Pages Function

官方端點未提供跨來源 CORS 回應標頭，因此由 `functions/api/stocks.js` 在 Cloudflare 伺服器端取得並整合官方資料。依照 Pages Functions 的檔案路由規則，此檔案對應同網域 `/api/stocks`，前端不再直接連線證交所或櫃買中心，也不使用第三方 CORS Proxy 或秘密金鑰。

Function 只接受 GET，設定八秒官方請求逾時與五分鐘快取。其中一個市場失敗時仍回傳另一市場；兩個來源都失敗時回傳安全的繁體中文錯誤。前端會保留已存股票及所有操作，但股價與日期顯示「—」，並提示「目前無法取得官方股票資料」。

**本年度累積 EPS、前一年度 EPS 與現金殖利率仍來自 `sample-data.js` 的範例資料，不代表真實資訊或投資建議。**

## 功能

- 優先依股票代號查詢官方上市、上櫃盤後資料，確認後加入收藏
- 使用 IndexedDB 保存已加入的股票，避免重複加入
- 依股票代號由小到大排序
- 依股票代號或股票名稱即時搜尋
- 顯示範例 EPS／殖利率，以及可取得時的官方盤後收盤價與資料日期
- 支援刪除單筆、重新載入及清除全部股票
- 桌面與手機響應式版面；手機表格可水平捲動
- 不重新載入頁面即可切換首頁、新增股票及個股資料

## 檔案用途

- `index.html`：首頁、新增股票頁與個股資料頁的 HTML 結構
- `style.css`：卡片、表格、按鈕、訊息及響應式版面樣式
- `sample-data.js`：尚未串接真實來源的 EPS 與殖利率測試資料
- `stock-api.js`：官方上市、上櫃盤後資料查詢、格式整理與記憶體快取
- `functions/api/stocks.js`：Cloudflare Pages Function，對應 `/api/stocks` 並整合兩個官方來源
- `db.js`：IndexedDB 開啟、建表、新增、讀取、查詢、刪除及清除操作
- `app.js`：頁面切換、新增流程、列表、搜尋、排序、刪除與提示訊息
- `README.md`：專案與測試、部署說明

## 本機測試

由於網站使用 IndexedDB 與 Pages Function，請勿直接雙擊 `index.html`，一般 HTTP 伺服器也不會執行 Function。請安裝 Node.js 後在 Repository 根目錄執行：

```console
npx wrangler pages dev .
```

預設開啟 `http://localhost:8788`，並可直接測試：

- `http://localhost:8788/api/stocks?code=2330`
- `http://localhost:8788/api/stocks?code=2317`
- `http://localhost:8788/api/stocks?code=6488`
- `http://localhost:8788/api/stocks?code=9999`（應回傳 404）

看到 HTTP 200 且 JSON 包含 `"success": true` 與股票資料，即代表 Function 已啟用。網站中也應能重新載入官方收盤資料；重新整理頁面後，IndexedDB 中已加入的股票仍會存在。

## 部署到 Cloudflare Pages

1. 必須使用 Cloudflare Pages 的 Git 整合，將此 Repository 連接至 Pages；只上傳靜態檔案不會部署 `functions`。
2. 登入 Cloudflare Dashboard，前往 **Workers & Pages**，選擇 **Create application → Pages → Connect to Git**。
3. 授權並選取這個 GitHub Repository，Production branch 設為 `main`。
4. 此專案沒有建置流程：Framework preset 選擇 `None`，Build command 留空，Build output directory 填入 `/`（Repository 根目錄）。
5. 儲存並部署。合併 PR 到 `main` 後，Cloudflare 會自動重新部署靜態網站與 Pages Function。
6. 部署完成後開啟 `https://你的網域/api/stocks?code=2330`；若回傳成功 JSON，而不是 HTML 或 404，即代表 Function 已成功啟用。

## IndexedDB 注意事項

加入的股票只儲存在目前瀏覽器、目前裝置及目前網站網域的 IndexedDB 中，不會同步到其他瀏覽器或裝置。無痕模式可能不會長期保留資料；清除瀏覽器網站資料、重設瀏覽器或移除該網站的儲存空間，都可能造成資料遺失。

本版本不包含登入、雲端資料庫、交易紀錄、損益計算、股息記帳、圖表或匯入匯出功能。

