// 自選股使用 localStorage，與原有 IndexedDB 個股資料完全分開。
document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "stock-trading-journal-watchlist-v1";
  const MAX_STOCKS = 50;
  const REFRESH_INTERVAL = 15_000;
  const page = document.querySelector("#watchlist-page");
  const form = document.querySelector("#watchlist-form");
  const codeInput = document.querySelector("#watchlist-code");
  const addButton = document.querySelector("#watchlist-add");
  const message = document.querySelector("#watchlist-message");
  const refreshButton = document.querySelector("#watchlist-refresh");
  const sortSelect = document.querySelector("#watchlist-sort");
  const tableBody = document.querySelector("#watchlist-table-body");
  const emptyState = document.querySelector("#watchlist-empty");
  const marketStatus = document.querySelector("#market-status");
  const updatedAt = document.querySelector("#watchlist-updated-at");

  let entries = loadEntries();
  let active = false;
  let isUpdating = false;
  let refreshTimer = null;
  let marketTimer = null;
  let messageTimer = null;
  let tradingState = null;

  function loadEntries() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(value)) return [];
      return value.slice(0, MAX_STOCKS).filter((item) => item && typeof item.code === "string").map((item) => ({
        code: item.code.trim().toUpperCase(),
        name: String(item.name || item.code),
        addedAt: item.addedAt || new Date().toISOString(),
        quote: item.quote && typeof item.quote === "object" ? item.quote : null,
        failed: false
      })).filter((item, index, list) => item.code && list.findIndex((other) => other.code === item.code) === index);
    } catch (error) {
      console.warn("自選股 localStorage 內容無法解析", error);
      return [];
    }
  }

  function saveEntries() {
    try {
      const value = entries.map(({ code, name, addedAt, quote }) => ({ code, name, addedAt, quote }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("自選股無法寫入 localStorage", error);
      showMessage("瀏覽器無法儲存自選股，請確認未停用網站儲存空間。", "error");
      return false;
    }
  }

  function showMessage(text, type = "success", autoHide = false) {
    clearTimeout(messageTimer);
    message.textContent = text;
    message.className = `message ${type}`;
    message.hidden = false;
    if (autoHide) messageTimer = setTimeout(() => { message.hidden = true; }, 4000);
  }

  function getSortedEntries() {
    const result = [...entries];
    if (sortSelect.value === "code") {
      result.sort((a, b) => a.code.localeCompare(b.code, "zh-Hant", { numeric: true }));
    } else if (sortSelect.value === "change-desc") {
      result.sort((a, b) => getChangePercent(b) - getChangePercent(a));
    } else if (sortSelect.value === "change-asc") {
      result.sort((a, b) => getChangePercent(a) - getChangePercent(b));
    }
    return result;
  }

  function getChangePercent(entry) {
    const value = toFiniteNumber(entry.quote?.changePercent);
    return value !== null ? value : sortSelect.value === "change-asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }

  function render() {
    const sortedEntries = getSortedEntries();
    const manualSort = sortSelect.value === "manual";
    tableBody.replaceChildren();
    emptyState.hidden = sortedEntries.length > 0;
    if (!sortedEntries.length) return;

    sortedEntries.forEach((entry) => {
      const originalIndex = entries.findIndex((item) => item.code === entry.code);
      const quote = entry.quote || {};
      const directionClass = getDirectionClass(quote.change);
      const row = document.createElement("tr");
      row.dataset.code = entry.code;
      row.innerHTML = `
        <td data-label="股票代號">${escapeHtml(entry.code)}</td>
        <td data-label="股票名稱" class="stock-name">${escapeHtml(quote.stockName || entry.name)}</td>
        <td data-label="目前成交價" class="quote-price ${directionClass}">${formatPrice(quote.currentPrice)}</td>
        <td data-label="漲跌金額" class="${directionClass}">${formatSigned(quote.change)}</td>
        <td data-label="漲跌幅" class="${directionClass}">${formatSigned(quote.changePercent, "%")}</td>
        <td data-label="今日開盤價">${formatPrice(quote.open)}</td>
        <td data-label="今日最高價">${formatPrice(quote.high)}</td>
        <td data-label="今日最低價">${formatPrice(quote.low)}</td>
        <td data-label="昨日收盤價">${formatPrice(quote.previousClose)}</td>
        <td data-label="成交量">${formatVolume(quote.volume)}</td>
        <td data-label="行情時間">${escapeHtml(formatQuoteTime(quote.updatedAt))}${entry.failed ? '<span class="quote-error">更新失敗</span>' : ""}</td>
        <td data-label="操作">
          <div class="row-actions">
            <button class="order-button" type="button" data-action="up" title="上移" aria-label="${escapeHtml(entry.name)}上移" ${!manualSort || originalIndex === 0 ? "disabled" : ""}>↑</button>
            <button class="order-button" type="button" data-action="down" title="下移" aria-label="${escapeHtml(entry.name)}下移" ${!manualSort || originalIndex === entries.length - 1 ? "disabled" : ""}>↓</button>
            <button class="watchlist-delete" type="button" data-action="delete">刪除</button>
          </div>
        </td>`;
      tableBody.append(row);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    codeInput.value = code;
    if (!code) { showMessage("請輸入股票代號。", "error"); codeInput.focus(); return; }
    if (!/^[0-9A-Z]{4,10}$/.test(code)) { showMessage("股票代號格式不正確，請輸入 4～10 位英數字。", "error"); return; }
    if (entries.some((entry) => entry.code === code)) { showMessage("此股票已在自選股清單中，無法重複新增。", "warning"); return; }
    if (entries.length >= MAX_STOCKS) { showMessage("自選股已達 50 支上限，請先刪除其他股票。", "warning"); return; }

    setAdding(true);
    showMessage("正在確認股票代號與行情…", "warning");
    try {
      const result = await StockAPI.getQuotes([code], true);
      const quote = result.stocks.find((stock) => stock.stockCode === code);
      if (!quote) { showMessage("查無此股票代號，或目前無法取得該股票資料。", "error"); return; }
      const entry = { code, name: quote.stockName || code, addedAt: new Date().toISOString(), quote, failed: false };
      entries.push(entry);
      if (!saveEntries()) { entries.pop(); return; }
      codeInput.value = "";
      render();
      setUpdatedAt();
      showMessage(`${entry.code} ${entry.name} 已加入自選股。`, "success", true);
      codeInput.focus();
    } catch (error) {
      console.warn("新增自選股失敗", error);
      showMessage(getNetworkErrorMessage(error, "新增股票失敗"), "error");
    } finally {
      setAdding(false);
    }
  });

  function setAdding(value) {
    addButton.disabled = value;
    codeInput.disabled = value;
    addButton.textContent = value ? "新增中…" : "新增股票";
  }

  async function refreshQuotes(reason = "manual") {
    if (isUpdating || !entries.length) {
      if (!entries.length && reason === "manual") showMessage("目前沒有可更新的自選股。", "warning", true);
      scheduleRefresh();
      return;
    }
    isUpdating = true;
    clearRefreshTimer();
    refreshButton.disabled = true;
    refreshButton.textContent = "更新中…";

    const codes = entries.map((entry) => entry.code);
    try {
      const result = await StockAPI.getQuotes(codes, reason !== "auto");
      const quoteMap = new Map(result.stocks.map((quote) => [quote.stockCode, quote]));
      const failedSet = new Set(result.failedCodes);
      entries.forEach((entry) => {
        const quote = quoteMap.get(entry.code);
        if (quote) {
          entry.quote = quote;
          entry.name = quote.stockName || entry.name;
          entry.failed = false;
        } else {
          entry.failed = true;
          failedSet.add(entry.code);
        }
      });
      saveEntries();
      render();
      if (quoteMap.size) setUpdatedAt();

      if (failedSet.size === entries.length) {
        showMessage("全部股票更新失敗，已保留上一次成功取得的行情。", "error");
      } else if (failedSet.size || result.warnings.length) {
        showMessage(`部分股票更新失敗（${[...failedSet].join("、")}），其他行情已更新。`, "warning");
      } else if (reason === "manual") {
        showMessage("自選股行情已更新。", "success", true);
      }
    } catch (error) {
      console.warn("自選股行情更新失敗", error);
      entries.forEach((entry) => { entry.failed = true; });
      render();
      showMessage(getNetworkErrorMessage(error, "全部股票更新失敗，已保留上一次成功取得的行情"), "error");
    } finally {
      isUpdating = false;
      refreshButton.disabled = false;
      refreshButton.textContent = "立即更新";
      scheduleRefresh();
    }
  }

  function setUpdatedAt() {
    updatedAt.textContent = new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date());
  }

  function getNetworkErrorMessage(error, fallback) {
    if (!navigator.onLine) return "網路連線中斷，請恢復連線後再試。";
    return `${error?.message || fallback}，請稍後再試。`;
  }

  function getTaipeiTimeParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function isTradingTime(date = new Date()) {
    const parts = getTaipeiTimeParts(date);
    if (["Sat", "Sun"].includes(parts.weekday)) return false;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
  }

  function updateMarketStatus() {
    const trading = isTradingTime();
    marketStatus.textContent = trading ? "交易中" : "非交易時間";
    marketStatus.className = `market-status ${trading ? "trading" : "closed"}`;
    return trading;
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (active && !document.hidden && updateMarketStatus() && entries.length) {
      refreshTimer = setTimeout(() => refreshQuotes("auto"), REFRESH_INTERVAL);
    }
  }

  function clearRefreshTimer() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function activate() {
    active = true;
    tradingState = updateMarketStatus();
    render();
    clearInterval(marketTimer);
    marketTimer = setInterval(() => {
      const nextState = updateMarketStatus();
      if (nextState !== tradingState) {
        tradingState = nextState;
        if (nextState && !document.hidden) refreshQuotes("auto");
        else clearRefreshTimer();
      }
    }, 30_000);
    refreshQuotes("enter");
    codeInput.focus();
  }

  function deactivate() {
    active = false;
    clearRefreshTimer();
    clearInterval(marketTimer);
    marketTimer = null;
  }

  refreshButton.addEventListener("click", () => refreshQuotes("manual"));
  sortSelect.addEventListener("change", render);
  tableBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    const row = event.target.closest("tr[data-code]");
    if (!button || !row) return;
    const index = entries.findIndex((entry) => entry.code === row.dataset.code);
    if (index < 0) return;

    if (button.dataset.action === "delete") {
      if (!window.confirm(`確定要從自選股刪除「${entries[index].code} ${entries[index].name}」嗎？`)) return;
      const [removed] = entries.splice(index, 1);
      if (!saveEntries()) { entries.splice(index, 0, removed); return; }
      render();
      showMessage("已從自選股刪除股票。", "success", true);
      scheduleRefresh();
      return;
    }

    const targetIndex = button.dataset.action === "up" ? index - 1 : index + 1;
    if (sortSelect.value !== "manual" || targetIndex < 0 || targetIndex >= entries.length) return;
    [entries[index], entries[targetIndex]] = [entries[targetIndex], entries[index]];
    saveEntries();
    render();
  });

  document.addEventListener("app:pagechange", (event) => {
    if (event.detail?.pageId === page.id) activate();
    else if (active) deactivate();
  });

  document.addEventListener("visibilitychange", () => {
    if (!active) return;
    if (document.hidden) clearRefreshTimer();
    else {
      tradingState = updateMarketStatus();
      refreshQuotes("visible");
    }
  });

  window.addEventListener("offline", () => {
    if (active) showMessage("網路連線已中斷，將保留目前顯示的行情。", "warning");
  });
  window.addEventListener("online", () => {
    if (active) refreshQuotes("visible");
  });

  function getDirectionClass(value) {
    const number = toFiniteNumber(value);
    if (number === null || number === 0) return "quote-flat";
    return number > 0 ? "quote-up" : "quote-down";
  }

  function formatPrice(value) {
    const number = toFiniteNumber(value);
    return number !== null ? number.toFixed(2) : "—";
  }

  function formatSigned(value, suffix = "") {
    const number = toFiniteNumber(value);
    if (number === null) return "—";
    const prefix = number > 0 ? "＋" : number < 0 ? "－" : "";
    return `${prefix}${Math.abs(number).toFixed(2)}${suffix}`;
  }

  function formatVolume(value) {
    const number = toFiniteNumber(value);
    return number !== null ? Math.round(number).toLocaleString("zh-TW") : "—";
  }

  // 上方最後更新保留完整日期；每檔行情只顯示官方回傳的時間。
  function formatQuoteTime(value) {
    const match = String(value ?? "").match(/(\d{2}:\d{2}:\d{2})/);
    return match?.[1] || "—";
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
  }

  render();
  updateMarketStatus();
});
