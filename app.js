document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const MAX_STOCKS = 50;
  const pages = [...document.querySelectorAll(".page")];
  const globalMessage = document.querySelector("#global-message");
  const stockForm = document.querySelector("#stock-form");
  const stockCodeInput = document.querySelector("#stock-code");
  const stockNameInput = document.querySelector("#stock-name");
  const stockSubmit = document.querySelector("#stock-submit");
  const stockFormMessage = document.querySelector("#stock-form-message");
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
  let localStocksCache = [];
  let localDividendsCache = [];
  let reordering = false;
  const messageTimers = new WeakMap();

  function setMessage(element, text, type = "success", autoHide = false) {
    if (!element) return;
    clearTimeout(messageTimers.get(element));
    element.textContent = text;
    element.className = `message ${type}`;
    element.hidden = !text;
    if (text && autoHide) {
      messageTimers.set(element, setTimeout(() => { element.hidden = true; }, 4500));
    }
  }

  function friendlyError(error, fallback) {
    return service?.getFriendlyError(error, fallback) || error?.message || fallback;
  }

  async function showPage(pageId) {
    if (!uid) return;
    pages.forEach((page) => {
      const active = page.id === pageId;
      page.classList.toggle("active", active);
      page.hidden = !active;
    });
    document.dispatchEvent(new CustomEvent("app:pagechange", { detail: { pageId } }));
    setMessage(globalMessage, "");

    if (pageId === "add-page") {
      stockForm.reset();
      setMessage(stockFormMessage, "");
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

  function setStockSaving(saving) {
    stockCodeInput.disabled = saving;
    stockNameInput.disabled = saving;
    stockSubmit.disabled = saving;
    stockSubmit.textContent = saving ? "儲存中…" : "新增股票";
  }

  stockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!uid || !service) return;

    const stockCode = stockCodeInput.value.trim().toUpperCase();
    const stockName = stockNameInput.value.trim();
    stockCodeInput.value = stockCode;
    stockNameInput.value = stockName;

    let stock;
    try {
      const currentStocks = await service.getStocks(uid);
      if (currentStocks.some((item) => item.stockCode === stockCode)) {
        setMessage(stockFormMessage, "此股票代碼已存在於股票清單中。", "warning");
        return;
      }
      if (currentStocks.length >= MAX_STOCKS) {
        setMessage(stockFormMessage, `股票清單最多只能儲存 ${MAX_STOCKS} 支股票。`, "error");
        return;
      }
      const sortOrder = currentStocks.reduce(
        (max, item) => Math.max(max, Number(item.sortOrder) || 0), 0
      ) + 1;
      stock = service.validateStock({ stockCode, stockName, sortOrder });
    } catch (error) {
      setMessage(stockFormMessage, friendlyError(error, "請確認股票代碼與名稱格式。"), "error");
      return;
    }

    setStockSaving(true);
    setMessage(stockFormMessage, "正在儲存股票…", "warning");
    try {
      await service.saveStock(uid, stock);
      stockForm.reset();
      await loadStocks();
      setMessage(stockFormMessage, `${stock.stockCode} ${stock.stockName} 已儲存至 Firebase。`, "success");
      stockCodeInput.focus();
    } catch (error) {
      setMessage(stockFormMessage, friendlyError(error, "新增股票失敗，請稍後再試。"), "error");
    } finally {
      setStockSaving(false);
    }
  });

  async function loadStocks(showReloadMessage = false) {
    if (!uid || !service) return;
    try {
      savedStocks = await service.getStocks(uid);
      renderStockList();
      await updateLocalImportOffer();
      if (showReloadMessage) {
        setMessage(globalMessage, "Firebase 股票清單已重新載入。", "success", true);
      }
    } catch (error) {
      setMessage(globalMessage, friendlyError(error, "無法讀取 Firebase 股票資料。"), "error");
    }
  }

  function renderStockList() {
    const keyword = stockFilter.value.trim().toLowerCase();
    const ordered = [...savedStocks].sort((a, b) => a.sortOrder - b.sortOrder
      || a.stockCode.localeCompare(b.stockCode, "zh-Hant", { numeric: true }));
    const filtered = ordered.filter((stock) =>
      stock.stockCode.toLowerCase().includes(keyword)
      || stock.stockName.toLowerCase().includes(keyword));

    tableBody.replaceChildren();
    emptyState.hidden = filtered.length > 0;
    if (!filtered.length) {
      emptyState.textContent = savedStocks.length && keyword ? "找不到符合條件的股票" : "尚未新增股票";
      return;
    }

    filtered.forEach((stock) => {
      const position = ordered.findIndex((item) => item.stockCode === stock.stockCode);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td data-label="股票代碼"><strong>${escapeHtml(stock.stockCode)}</strong></td>
        <td data-label="股票名稱" class="stock-name">${escapeHtml(stock.stockName)}</td>
        <td data-label="自訂排序">
          <div class="stock-order-actions">
            <span class="sort-position">第 ${position + 1} 位</span>
            <button class="icon-btn" type="button" data-action="up" data-code="${escapeHtml(stock.stockCode)}"
              aria-label="上移 ${escapeHtml(stock.stockCode)}" ${position === 0 || reordering ? "disabled" : ""}>↑</button>
            <button class="icon-btn" type="button" data-action="down" data-code="${escapeHtml(stock.stockCode)}"
              aria-label="下移 ${escapeHtml(stock.stockCode)}" ${position === ordered.length - 1 || reordering ? "disabled" : ""}>↓</button>
          </div>
        </td>
        <td data-label="操作">
          <div class="stock-row-actions">
            <button class="secondary-btn compact-btn" type="button" data-action="dividends"
              data-code="${escapeHtml(stock.stockCode)}">前往股息紀錄</button>
            <button class="danger-btn compact-btn" type="button" data-action="delete"
              data-code="${escapeHtml(stock.stockCode)}" data-name="${escapeHtml(stock.stockName)}">刪除</button>
          </div>
        </td>`;
      tableBody.append(row);
    });
  }

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !uid || !service) return;
    const action = button.dataset.action;
    const code = String(button.dataset.code || "").trim().toUpperCase();

    if (action === "dividends") {
      await showPage("dividend-page");
      return;
    }
    if (action === "up") {
      await moveStock(code, -1);
      return;
    }
    if (action === "down") {
      await moveStock(code, 1);
      return;
    }
    if (action !== "delete") return;

    if (!window.confirm(`確定要刪除「${button.dataset.name}」嗎？股息子集合會保留以避免誤刪歷史紀錄。`)) return;
    button.disabled = true;
    try {
      await service.deleteStock(uid, code);
      await loadStocks();
      setMessage(globalMessage, "股票刪除成功。", "success", true);
    } catch (error) {
      setMessage(globalMessage, friendlyError(error, "刪除失敗，請稍後再試。"), "error");
      button.disabled = false;
    }
  });

  async function moveStock(code, direction) {
    if (reordering) return;
    const ordered = [...savedStocks].sort((a, b) => a.sortOrder - b.sortOrder
      || a.stockCode.localeCompare(b.stockCode, "zh-Hant", { numeric: true }));
    const from = ordered.findIndex((stock) => stock.stockCode === code);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;

    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    reordering = true;
    renderStockList();
    try {
      await service.updateStockOrder(uid, ordered.map((stock) => stock.stockCode));
      savedStocks = ordered.map((stock, index) => ({ ...stock, sortOrder: index + 1 }));
      setMessage(globalMessage, "自訂順序已同步至 Firebase。", "success", true);
    } catch (error) {
      setMessage(globalMessage, friendlyError(error, "自訂順序儲存失敗。"), "error");
      await loadStocks();
    } finally {
      reordering = false;
      renderStockList();
    }
  }

  stockFilter.addEventListener("input", renderStockList);
  document.querySelector("#reload-stocks").addEventListener("click", () => loadStocks(true));
  document.querySelector("#clear-stocks").addEventListener("click", async () => {
    if (!uid || !service) return;
    if (!savedStocks.length) {
      setMessage(globalMessage, "目前沒有可清除的股票資料。", "warning", true);
      return;
    }
    if (!window.confirm("確定要清除目前帳號的全部股票嗎？股息子集合會保留，但股票清單將從 Firebase 移除。")) return;
    try {
      await service.clearStocks(uid);
      await loadStocks();
      setMessage(globalMessage, "已清除 Firebase 股票資料。", "success", true);
    } catch (error) {
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
      stocks: Array.from(map.values()).slice(0, MAX_STOCKS)
        .map((stock, index) => ({ ...stock, sortOrder: index + 1 })),
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
        if (await service.getStock(uid, stock.stockCode)) stats.skipped += 1;
        else {
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
      `本機股票與股息匯入完成：成功 ${stats.success}、略過 ${stats.skipped}、失敗 ${stats.failed}。`,
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
    tableBody.replaceChildren();
    emptyState.hidden = false;
    localImportPanel.hidden = true;
    stockForm.reset();
    setMessage(globalMessage, "");
    setMessage(stockFormMessage, "");
    setMessage(cloudToolsMessage, "");

    if (!uid || !service) {
      document.dispatchEvent(new CustomEvent("app:pagechange", { detail: { pageId: "" } }));
      return;
    }
    await loadStocks();
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

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
  }
});
