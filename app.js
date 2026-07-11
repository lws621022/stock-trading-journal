// 此檔案只負責畫面流程；資料庫操作委派給 db.js，測試行情取自 sample-data.js。
document.addEventListener("DOMContentLoaded", () => {
  const pages = [...document.querySelectorAll(".page")];
  const globalMessage = document.querySelector("#global-message");
  const searchForm = document.querySelector("#stock-search-form");
  const stockCodeInput = document.querySelector("#stock-code");
  const searchMessage = document.querySelector("#search-message");
  const searchResult = document.querySelector("#search-result");
  const searchButton = searchForm.querySelector('button[type="submit"]');
  const stockFilter = document.querySelector("#stock-filter");
  const tableBody = document.querySelector("#stock-table-body");
  const emptyState = document.querySelector("#empty-state");
  let savedStocks = [];
  let pendingStock = null;
  let marketData = new Map();
  let messageTimer;

  function setMessage(element, text, type = "success", autoHide = false) {
    clearTimeout(messageTimer);
    element.textContent = text;
    element.className = `message ${type}`;
    element.hidden = false;
    if (autoHide) messageTimer = setTimeout(() => { element.hidden = true; }, 3500);
  }

  function clearSearchArea() {
    pendingStock = null;
    searchMessage.hidden = true;
    searchResult.hidden = true;
    searchResult.replaceChildren();
  }

  async function showPage(pageId) {
    pages.forEach((page) => {
      const active = page.id === pageId;
      page.classList.toggle("active", active);
      page.hidden = !active;
    });
    globalMessage.hidden = true;
    if (pageId === "add-page") { clearSearchArea(); stockCodeInput.focus(); }
    if (pageId === "list-page") { stockFilter.value = ""; await loadStocks(); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSearchArea();
    const stockCode = stockCodeInput.value.trim().toUpperCase();
    stockCodeInput.value = stockCode;
    if (!stockCode) { setMessage(searchMessage, "請輸入股票代號", "error"); stockCodeInput.focus(); return; }

    try {
      if (await StockDB.stockExists(stockCode)) { setMessage(searchMessage, "此股票已存在於個股資料中", "warning"); return; }
      setSearching(true);
      setMessage(searchMessage, "資料查詢中", "warning");
      try {
        const result = await StockAPI.findStock(stockCode);
        pendingStock = result.stock;
        if (result.warnings.length) setMessage(searchMessage, result.warnings.join("；"), "warning");
        else searchMessage.hidden = true;
      } catch (apiError) {
        console.warn(apiError);
        setMessage(searchMessage, "目前無法取得官方股票資料", "error");
        return;
      }
      if (!pendingStock) { setMessage(searchMessage, "查無此股票代號", "error"); return; }
      renderSearchResult(pendingStock);
    } catch (error) { console.error(error); setMessage(searchMessage, "資料查詢失敗，請稍後再試。", "error"); }
    finally { setSearching(false); }
  });

  function setSearching(isSearching) {
    searchButton.disabled = isSearching;
    stockCodeInput.disabled = isSearching;
    searchButton.textContent = isSearching ? "資料查詢中" : "查詢股票";
  }

  function renderSearchResult(stock) {
    searchResult.innerHTML = `
      <div class="result-details">
        <div><span>股票代號</span><strong>${escapeHtml(stock.stockCode)}</strong></div>
        <div><span>股票名稱</span><strong>${escapeHtml(stock.stockName)}</strong></div>
        <div><span>市場別</span><strong>${escapeHtml(stock.market)} · ${escapeHtml(stock.type)}</strong></div>
      </div>
      <div class="result-actions">
        <button id="confirm-add" class="button primary" type="button">確定新增</button>
        <button id="cancel-add" class="button secondary" type="button">取消</button>
      </div>`;
    searchResult.hidden = false;
    document.querySelector("#confirm-add").addEventListener("click", confirmAddStock);
    document.querySelector("#cancel-add").addEventListener("click", clearSearchArea);
  }

  async function confirmAddStock() {
    if (!pendingStock) return;
    const stockToAdd = pendingStock;
    try {
      if (await StockDB.stockExists(stockToAdd.stockCode)) { clearSearchArea(); setMessage(searchMessage, "此股票已存在於個股資料中", "warning"); return; }
      await StockDB.addStock(stockToAdd);
      stockCodeInput.value = "";
      clearSearchArea();
      setMessage(searchMessage, "股票新增成功", "success");
      stockCodeInput.focus();
    } catch (error) { console.error(error); setMessage(searchMessage, "新增失敗，請稍後再試。", "error"); }
  }

  async function loadStocks(showReloadMessage = false, forceRefresh = false) {
    try {
      savedStocks = await StockDB.getAllStocks();
      savedStocks.sort((a, b) => a.stockCode.localeCompare(b.stockCode, "zh-Hant", { numeric: true }));
      marketData = new Map();
      renderStockList();
      if (!savedStocks.length) return;
      try {
        const result = await StockAPI.getStocks(savedStocks.map((stock) => stock.stockCode), forceRefresh);
        marketData = new Map(result.stocks.map((stock) => [stock.stockCode, stock]));
        renderStockList();
        const missing = savedStocks.filter((stock) => !marketData.has(stock.stockCode)).length;
        if (result.warnings.length || missing) setMessage(globalMessage, "部分股票資料取得失敗，無法取得的股價以「—」顯示。", "warning");
        else if (showReloadMessage) setMessage(globalMessage, "最新收盤資料已重新載入", "success", true);
      } catch (apiError) {
        console.warn(apiError);
        renderStockList();
        setMessage(globalMessage, "目前無法取得官方股票資料", "warning");
      }
    } catch (error) { console.error(error); setMessage(globalMessage, "無法讀取股票資料，請重新整理後再試。", "error"); }
  }

  function renderStockList() {
    const keyword = stockFilter.value.trim().toLowerCase();
    const filtered = savedStocks.filter((stock) => stock.stockCode.toLowerCase().includes(keyword) || stock.stockName.toLowerCase().includes(keyword));
    tableBody.replaceChildren();
    emptyState.hidden = filtered.length > 0;
    if (!filtered.length) {
      emptyState.textContent = savedStocks.length && keyword ? "找不到符合條件的股票" : "尚未新增股票";
      return;
    }
    filtered.forEach((savedStock) => {
      const sample = SAMPLE_STOCKS.find((item) => item.stockCode === savedStock.stockCode) || {};
      const live = marketData.get(savedStock.stockCode) || {};
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(savedStock.stockCode)}</td><td class="stock-name">${escapeHtml(live.stockName || savedStock.stockName)}</td>
        <td>${formatNumber(sample.currentYearEps)}</td><td>${formatNumber(sample.previousYearEps)}</td>
        <td>${formatNumber(sample.dividendYield, "%")}</td><td>${formatNumber(live.previousClose)}</td>
        <td>${formatNumber(live.latestClose)}</td><td>${escapeHtml(live.updatedAt || "—")}</td>
        <td><button class="delete-button" type="button" data-id="${savedStock.id}" data-name="${escapeHtml(savedStock.stockName)}">刪除</button></td>`;
      tableBody.append(row);
    });
  }

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest(".delete-button");
    if (!button) return;
    if (!window.confirm(`確定要刪除「${button.dataset.name}」嗎？`)) return;
    try { await StockDB.deleteStock(Number(button.dataset.id)); await loadStocks(); setMessage(globalMessage, "股票刪除成功", "success", true); }
    catch (error) { console.error(error); setMessage(globalMessage, "刪除失敗，請稍後再試。", "error"); }
  });

  stockFilter.addEventListener("input", renderStockList);
  document.querySelector("#reload-stocks").addEventListener("click", () => loadStocks(true, true));
  document.querySelector("#clear-stocks").addEventListener("click", async () => {
    if (!savedStocks.length) { setMessage(globalMessage, "目前沒有可清除的股票資料", "warning", true); return; }
    if (!window.confirm("確定要清除全部股票嗎？此操作會刪除目前瀏覽器中的所有股票資料，且無法復原。")) return;
    try { await StockDB.clearStocks(); await loadStocks(); setMessage(globalMessage, "已清除全部股票資料", "success", true); }
    catch (error) { console.error(error); setMessage(globalMessage, "清除失敗，請稍後再試。", "error"); }
  });

  function formatNumber(value, suffix = "") { return value === null || value === undefined || value === "" ? "—" : `${Number(value).toFixed(2)}${suffix}`; }
  function escapeHtml(value) { const div = document.createElement("div"); div.textContent = String(value); return div.innerHTML; }

  StockDB.openDatabase().catch((error) => { console.error(error); setMessage(globalMessage, "瀏覽器不支援或無法啟用本機資料庫。", "error"); });
});

