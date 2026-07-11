# 我的股票資料庫

一個個人使用的台股資料管理網頁，以純 HTML、CSS 與原生 JavaScript 製作，可部署至 Cloudflare Pages。使用者可以查詢內建的範例股票、加入個股資料、搜尋、刪除單筆資料或清除全部資料，不需要登入或雲端資料庫。

## 第二階段資料來源

股票代號、名稱、收盤價與資料日期優先取自官方公開盤後資料：上市股票使用[臺灣證券交易所 OpenAPI](https://openapi.twse.com.tw/)，上櫃股票使用[證券櫃檯買賣中心 OpenAPI](https://www.tpex.org.tw/openapi/)。兩者皆免金鑰。

「最新交易日收盤價」是官方資料中最近交易日的盤後收盤價；「前一交易日收盤價」由最新收盤價扣除官方提供的當日漲跌價差計算。資料日期是該筆盤後資料的交易日。這些資料不是盤中即時價，通常於每個交易日收盤後由資料提供單位更新；網站使用五分鐘記憶體快取，按「重新載入資料」會略過快取重新取得。

### 純前端存取限制

實測官方端點未提供跨來源 CORS 回應標頭，因此部署在 GitHub Pages 或純靜態 Cloudflare Pages 時，瀏覽器可能阻擋直接讀取。本站不使用不安全的第三方 CORS 代理，也不在前端放置秘密金鑰。官方資料無法連線時：新增頁仍可用 `sample-data.js` 的範例名單查詢既有測試股票；列表保持可操作，但真實股票名稱沿用 IndexedDB 既有名稱，收盤價與更新時間顯示「—」，並顯示繁體中文提示。

下一步建議新增同網域的 Cloudflare Pages Function，由後端向官方端點取資料並設定允許本站來源的 CORS 標頭，同時加入限流與快取。因本階段要求所有檔案留在根目錄，本次未建立 Functions 子目錄。

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
- `sample-data.js`：第一階段使用的範例股票與測試行情資料
- `stock-api.js`：官方上市、上櫃盤後資料查詢、格式整理與記憶體快取
- `db.js`：IndexedDB 開啟、建表、新增、讀取、查詢、刪除及清除操作
- `app.js`：頁面切換、新增流程、列表、搜尋、排序、刪除與提示訊息
- `README.md`：專案與測試、部署說明

## 本機測試

由於網站使用 IndexedDB，請透過本機 HTTP 伺服器測試，不建議直接雙擊 `index.html`。

方法一：在 VS Code 安裝 **Live Server**，於 `index.html` 選擇「Open with Live Server」。

方法二：在 Repository 根目錄執行：

```bash
python -m http.server 8000
```

接著以瀏覽器開啟 [http://localhost:8000](http://localhost:8000)。請測試 `2330` 台積電、`2317` 鴻海、`6488` 環球晶、無效代號、重複新增，以及中斷網路後的錯誤提示。重新整理頁面後，確認 IndexedDB 中的股票仍存在。

## 部署到 Cloudflare Pages

1. 將此 Repository 推送到 GitHub。
2. 登入 Cloudflare Dashboard，前往 **Workers & Pages**，選擇 **Create application → Pages → Connect to Git**。
3. 授權並選取這個 GitHub Repository。
4. 此專案沒有建置流程：Framework preset 選擇 `None`，Build command 留空，Build output directory 填入 `/`（Repository 根目錄）。
5. 儲存並部署。之後推送至 Cloudflare Pages 綁定的正式分支時會自動重新部署。

## IndexedDB 注意事項

加入的股票只儲存在目前瀏覽器、目前裝置及目前網站網域的 IndexedDB 中，不會同步到其他瀏覽器或裝置。無痕模式可能不會長期保留資料；清除瀏覽器網站資料、重設瀏覽器或移除該網站的儲存空間，都可能造成資料遺失。

本版本不包含登入、雲端資料庫、交易紀錄、損益計算、股息記帳、圖表或匯入匯出功能。

