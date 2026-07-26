
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
  const localImportPanel = document.querySelector("#local-import-panel");
  const localImportButton = document.querySelector("#import-local-stocks");
  const exportCsvButton = document.querySelector("#export-csv");
  const importCsvButton = document.querySelector("#import-csv");
  const importCsvFile = document.querySelector("#import-csv-file");
  const cloudToolsMessage = document.querySelector("#cloud-tools-message");

  let uid = "";
  let service = null;
  let savedStocks = [];
  let pendingStock = null;
  let marketData = new Map();
  let messageTimer;
  let localStocksCache = [];
  let localDividendsCache = [];

  function setMessage(element, text, type = "success", autoHide = false) {
    if (!element) return;
    clearTimeout(messageTimer);
    element.textContent = text;
    element.className = `message ${type}`;
    element.hidden = !text;
    if (text && autoHide) messageTimer = setTimeout(() => { element.hidden = true; }, 4500);
  }

  function friendlyError(error, fallback) {
    return service?.getFriendlyError(error, fallback) || error?.message || fallback;
  }

  function clearSearchArea() {
    pendingStock = null;
    searchMessage.hidden = true;
    searchResult.hidden = true;
    searchResult.replaceChildren();
  }

  async function showPage(pageId) {
    if (!uid) return;
    pages.forEach((page) => {
      const active = page.id === pageId;
      page.classList.toggle("active", active);
      page.hidden = !active;
    });
    document.dispatchEvent(new CustomEvent("app:pagechange", { detail: { pageId } }));
    globalMessage.hidden = true;
    if (pageId === "add-page") {
      clearSearchArea();
      stockCodeInput.focus();
    }
    if (pageId === "list-page") {
      stockFilter.value = "";
      await loadStocks();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!uid || !service) return;
    clearSearchArea();
    const stockCode = stockCodeInput.value.trim().toUpperCase();
    stockCodeInput.value = stockCode;
    if (!stockCode) {
      setMessage(searchMessage, "請輸入股票代號", "error");
      stockCodeInput.focus();
      return;
    }

    try {
      if (await service.getStock(uid, stockCode)) {
        setMessage(searchMessage, "此股票已存在於 Firebase 個股資料中", "warning");
        return;
      }
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
      if (!pendingStock) {
        setMessage(searchMessage, "查無此股票代號", "error");
        return;
      }
      renderSearchResult(pendingStock);
    } catch (error) {
      console.error(error);
      setMessage(searchMessage, friendlyError(error, "資料查詢失敗，請稍後再試。"), "error");
    } finally {
      setSearching(false);
    }
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
    if (!pendingStock || !uid || !service) return;
    const stockToAdd = pendingStock;
    const button = document.querySelector("#confirm-add");
    button.disabled = true;
    button.textContent = "儲存中…";
    try {
      if (await service.getStock(uid, stockToAdd.stockCode)) {
        clearSearchArea();
        setMessage(searchMessage, "此股票已存在於 Firebase 個股資料中", "warning");
        return;
      }
      const sortOrder = savedStocks.reduce((max, stock) => Math.max(max, Number(stock.sortOrder) || 0), 0) + 1;
      await service.saveStock(uid, {
        stockCode: stockToAdd.stockCode,
        stockName: stockToAdd.stockName,
        sortOrder
      });
      stockCodeInput.value = "";
      clearSearchArea();
      setMessage(searchMessage, "股票已儲存至 Firebase", "success");
      await loadStocks();
      stockCodeInput.focus();
    } catch (error) {
      console.error(error);
      setMessage(searchMessage, friendlyError(error, "新增失敗，請稍後再試。"), "error");
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "確定新增";
      }
    }
  }

  async function loadStocks(showReloadMessage = false, forceRefresh = false) {
    if (!uid || !service) return;
    try {
      savedStocks = await service.getStocks(uid);
      marketData = new Map();
      renderStockList();
      await updateLocalImportOffer();
      if (!savedStocks.length) return;
      try {
        const result = await StockAPI.getStocks(savedStocks.map((stock) => stock.stockCode), forceRefresh);
        marketData = new Map(result.stocks.map((stock) => [stock.stockCode, stock]));
        renderStockList();
        const missing = savedStocks.filter((stock) => !marketData.has(stock.stockCode)).length;
        if (result.warnings.length || missing) {
          setMessage(globalMessage, "部分股票資料取得失敗，無法取得的股價以「—」顯示。", "warning");
        } else if (showReloadMessage) {
          setMessage(globalMessage, "最新收盤資料已重新載入", "success", true);
        }
      } catch (apiError) {
        console.warn(apiError);
        renderStockList();
        setMessage(globalMessage, "目前無法取得官方股票資料", "warning");
      }
    } catch (error) {
      console.error(error);
      setMessage(globalMessage, friendlyError(error, "無法讀取 Firebase 股票資料。"), "error");
    }
  }

  function renderStockList() {
    const keyword = stockFilter.value.trim().toLowerCase();
    const filtered = savedStocks.filter((stock) =>
      stock.stockCode.toLowerCase().includes(keyword)
      || stock.stockName.toLowerCase().includes(keyword));
    tableBody.replaceChildren();
    emptyState.hidden = filtered.length > 0;
    if (!filtered.length) {
      emptyState.textContent = savedStocks.length && keyword ? "找不到符合條件的股票" : "尚未新增股票";
      return;
    }
    filtered.forEach((savedStock) => {
      const live = marketData.get(savedStock.stockCode) || {};
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(savedStock.stockCode)}</td>
        <td class="stock-name">${escapeHtml(live.stockName || savedStock.stockName)}</td>
        <td>${formatNumber(live.currentYearEps)}</td><td>${formatNumber(live.previousYearEps)}</td>
        <td>${formatNumber(live.dividendYield, "%")}</td><td>${formatNumber(live.previousClose)}</td>
        <td>${formatNumber(live.latestClose)}</td><td>${escapeHtml(live.updatedAt || "—")}</td>
        <td><button class="delete-button" type="button" data-code="${escapeHtml(savedStock.stockCode)}"
          data-name="${escapeHtml(savedStock.stockName)}">刪除</button></td>`;
      tableBody.append(row);
    });
  }

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest(".delete-button");
    if (!button || !uid || !service) return;
    if (!window.confirm(`確定要刪除「${button.dataset.name}」嗎？股息子集合會保留以避免誤刪歷史紀錄。`)) return;
    button.disabled = true;
    try {
      await service.deleteStock(uid, button.dataset.code);
      await loadStocks();
      setMessage(globalMessage, "股票刪除成功", "success", true);
    } catch (error) {
      console.error(error);
      setMessage(globalMessage, friendlyError(error, "刪除失敗，請稍後再試。"), "error");
      button.disabled = false;
    }
  });

  stockFilter.addEventListener("input", renderStockList);
  document.querySelector("#reload-stocks").addEventListener("click", () => loadStocks(true, true));
  document.querySelector("#clear-stocks").addEventListener("click", async () => {
    if (!uid || !service) return;
    if (!savedStocks.length) {
      setMessage(globalMessage, "目前沒有可清除的股票資料", "warning", true);
      return;
    }
    if (!window.confirm("確定要清除目前帳號的全部股票嗎？股息子集合會保留，但股票清單將從 Firebase 移除。")) return;
    try {
      await service.clearStocks(uid);
      await loadStocks();
      setMessage(globalMessage, "已清除 Firebase 股票資料", "success", true);
    } catch (error) {
      console.error(error);
      setMessage(globalMessage, friendlyError(error, "清除失敗，請稍後再試。"), "error");
    }
  });

  async function collectLocalStocks() {
    const map = new Map();
    try {
      const indexedStocks = await StockDB.getAllStocks();
      indexedStocks.forEach((stock) => {
        const stockCode = String(stock.stockCode || "").trim().toUpperCase();
        const stockName = String(stock.stockName || "").trim();
        if (stockCode && stockName) map.set(stockCode, { stockCode, stockName });
      });
    } catch (error) {
      console.warn("無法讀取 IndexedDB 匯入來源", error);
    }

    try {
      const localWatchlist = JSON.parse(localStorage.getItem("stock-trading-journal-watchlist-v1") || "[]");
      if (Array.isArray(localWatchlist)) {
        localWatchlist.forEach((stock) => {
          const stockCode = String(stock.code || "").trim().toUpperCase();
          const stockName = String(stock.name || stock.stockName || "").trim();
          if (stockCode && stockName) map.set(stockCode, { stockCode, stockName });
        });
      }
    } catch (error) {
      console.warn("無法讀取 localStorage 匯入來源", error);
    }

    const dividendMap = new Map();
    try {
      const localDividendData = JSON.parse(
        localStorage.getItem("stock-trading-journal-dividends-v1") || "{}"
      );
      if (localDividendData && !Array.isArray(localDividendData)
        && typeof localDividendData === "object") {
        Object.entries(localDividendData).forEach(([rawCode, entry]) => {
          const stockCode = String(rawCode || "").trim().toUpperCase();
          const stockName = String(entry?.stockName || stockCode).trim();
          if (stockCode && stockName && !map.has(stockCode)) {
            map.set(stockCode, { stockCode, stockName });
          }
          if (!Array.isArray(entry?.dividends)) return;
          entry.dividends.forEach((record) => {
            try {
              const dividend = service.validateDividend(record);
              dividendMap.set(`${stockCode}:${dividend.year}`, { stockCode, ...dividend });
            } catch (error) {
              console.warn("略過無效的本機股息資料", error);
            }
          });
        });
      }
    } catch (error) {
      console.warn("無法讀取本機股息匯入來源", error);
    }

    return {
      stocks: Array.from(map.values()).map((stock, index) => ({ ...stock, sortOrder: index + 1 })),
      dividends: Array.from(dividendMap.values())
    };
  }

  async function updateLocalImportOffer() {
    if (!uid || savedStocks.length) {
      localImportPanel.hidden = true;
      return;
    }
    const localData = await collectLocalStocks();
    localStocksCache = localData.stocks;
    localDividendsCache = localData.dividends;
    localImportPanel.hidden = localStocksCache.length === 0;
  }

  localImportButton.addEventListener("click", async () => {
    if (!uid || !service || !localStocksCache.length) return;
    if (!window.confirm(`確定要將此瀏覽器的 ${localStocksCache.length} 支股票匯入目前登入的 Firebase 帳號嗎？原本機資料不會刪除。`)) return;
    localImportButton.disabled = true;
    localImportButton.textContent = "匯入中…";
    setMessage(cloudToolsMessage, "正在匯入本機股票資料…", "warning");

    const stats = { success: 0, skipped: 0, failed: 0 };
    for (const stock of localStocksCache) {
      try {
        if (await service.getStock(uid, stock.stockCode)) {
          stats.skipped += 1;
        } else {
          await service.saveStock(uid, stock, { notify: false });
          stats.success += 1;
        }
      } catch (error) {
        console.error("本機股票匯入失敗", error);
        stats.failed += 1;
      }
    }

    for (const dividend of localDividendsCache) {
      try {
        await service.saveDividend(uid, dividend.stockCode, dividend, {
          allowUpdate: false,
          notify: false
        });
        stats.success += 1;
      } catch (error) {
        if (String(error?.code || "").includes("duplicate-year")) stats.skipped += 1;
        else {
          console.error("本機股息匯入失敗", error);
          stats.failed += 1;
        }
      }
    }

    if (stats.success) {
      document.dispatchEvent(new CustomEvent("firebase:datachange", {
        detail: { type: "import", source: "app" }
      }));
    }
    setMessage(cloudToolsMessage,
      `本機股票匯入完成：成功 ${stats.success}、略過 ${stats.skipped}、失敗 ${stats.failed}。`,
      stats.failed ? "warning" : "success");
    await loadStocks();
    localImportButton.disabled = false;
    localImportButton.textContent = "將目前股票匯入 Firebase";
  });

  exportCsvButton.addEventListener("click", async () => {
    if (!uid || !service) return;
    exportCsvButton.disabled = true;
    exportCsvButton.textContent = "匯出中…";
    try {
      const csv = await service.exportCsv(uid);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stock-dividends-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(cloudToolsMessage, "CSV 已匯出，包含目前帳號的全部股票與股息資料。", "success", true);
    } catch (error) {
      setMessage(cloudToolsMessage, friendlyError(error, "CSV 匯出失敗。"), "error");
    } finally {
      exportCsvButton.disabled = false;
      exportCsvButton.textContent = "匯出 CSV";
    }
  });

  importCsvButton.addEventListener("click", () => {
    if (uid) importCsvFile.click();
  });

  importCsvFile.addEventListener("change", async () => {
    const file = importCsvFile.files?.[0];
    if (!file || !uid || !service) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage(cloudToolsMessage, "CSV 檔案不可超過 5MB。", "error");
      importCsvFile.value = "";
      return;
    }
    if (!window.confirm(`確定要匯入「${file.name}」嗎？相同股票及年度會更新現有資料。`)) {
      importCsvFile.value = "";
      return;
    }

    importCsvButton.disabled = true;
    importCsvButton.textContent = "匯入中…";
    setMessage(cloudToolsMessage, "CSV 驗證與匯入中…", "warning");
    try {
      const stats = await service.importCsv(uid, await file.text());
      const detail = stats.details.length ? ` 詳細錯誤：${stats.details.slice(0, 3).join("；")}` : "";
      setMessage(cloudToolsMessage,
        `CSV 匯入完成：新增 ${stats.added}、更新 ${stats.updated}、略過 ${stats.skipped}、錯誤 ${stats.errors}。${detail}`,
        stats.errors ? "warning" : "success");
      await loadStocks();
    } catch (error) {
      setMessage(cloudToolsMessage, friendlyError(error, "CSV 匯入失敗。"), "error");
    } finally {
      importCsvButton.disabled = false;
      importCsvButton.textContent = "匯入 CSV";
      importCsvFile.value = "";
    }
  });

  async function handleAuthChange(user, nextService) {
    service = nextService || window.FirebaseService || null;
    uid = user?.uid || "";
    savedStocks = [];
    marketData = new Map();
    pendingStock = null;
    tableBody.replaceChildren();
    emptyState.hidden = false;
    localImportPanel.hidden = true;
    setMessage(globalMessage, "");
    setMessage(cloudToolsMessage, "");

    if (!uid || !service) {
      document.dispatchEvent(new CustomEvent("app:pagechange", { detail: { pageId: "" } }));
      return;
    }
    await loadStocks();
    await updateLocalImportOffer();
  }

  document.addEventListener("firebase:authchange", (event) => {
    handleAuthChange(event.detail?.user || null, event.detail?.service);
  });

  document.addEventListener("firebase:datachange", (event) => {
    if (!uid || event.detail?.source === "app") return;
    const activePage = pages.find((page) => page.classList.contains("active"))?.id;
    if (activePage === "list-page" || activePage === "home-page") loadStocks();
  });

  if (window.FirebaseAuthState?.ready) {
    handleAuthChange(window.FirebaseAuthState.user, window.FirebaseService);
  }

  function formatNumber(value, suffix = "") {
    return value === null || value === undefined || value === "" ? "—" : `${Number(value).toFixed(2)}${suffix}`;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
  }
});
