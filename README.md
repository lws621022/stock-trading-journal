# 我的股票資料庫

一個個人使用的台股資料管理網頁，以純 HTML、CSS 與原生 JavaScript 製作，可部署至 Cloudflare Pages。使用者可以查詢內建的範例股票、加入個股資料、搜尋、刪除單筆資料或清除全部資料，不需要登入或雲端資料庫。

## 目前資料狀態

目前為第一階段功能版本，股票名稱、EPS、現金殖利率、收盤價與更新時間皆來自 `sample-data.js` 的測試資料，**尚未串接真實股票 API，也不代表即時行情或投資建議**。

## 功能

- 依股票代號查詢範例股票，確認後加入收藏
- 使用 IndexedDB 保存已加入的股票，避免重複加入
- 依股票代號由小到大排序
- 依股票代號或股票名稱即時搜尋
- 顯示 EPS、殖利率、收盤價與資料更新時間
- 支援刪除單筆、重新載入及清除全部股票
- 桌面與手機響應式版面；手機表格可水平捲動
- 不重新載入頁面即可切換首頁、新增股票及個股資料

## 檔案用途

- `index.html`：首頁、新增股票頁與個股資料頁的 HTML 結構
- `style.css`：卡片、表格、按鈕、訊息及響應式版面樣式
- `sample-data.js`：第一階段使用的範例股票與測試行情資料
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

接著以瀏覽器開啟 [http://localhost:8000](http://localhost:8000)。可測試加入 `2330`、`0050` 等範例代號，並重新整理頁面確認資料仍存在。

## 部署到 Cloudflare Pages

1. 將此 Repository 推送到 GitHub。
2. 登入 Cloudflare Dashboard，前往 **Workers & Pages**，選擇 **Create application → Pages → Connect to Git**。
3. 授權並選取這個 GitHub Repository。
4. 此專案沒有建置流程：Framework preset 選擇 `None`，Build command 留空，Build output directory 填入 `/`（Repository 根目錄）。
5. 儲存並部署。之後推送至 Cloudflare Pages 綁定的正式分支時會自動重新部署。

## IndexedDB 注意事項

加入的股票只儲存在目前瀏覽器、目前裝置及目前網站網域的 IndexedDB 中，不會同步到其他瀏覽器或裝置。無痕模式可能不會長期保留資料；清除瀏覽器網站資料、重設瀏覽器或移除該網站的儲存空間，都可能造成資料遺失。

本版本不包含登入、雲端資料庫、交易紀錄、損益計算、股息記帳、圖表、匯入匯出或外部股票 API。

