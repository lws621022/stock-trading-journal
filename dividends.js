
(() => {
  "use strict";

  // 股息資料與自訂排序獨立保存；股票移出清單時不刪除歷史資料。
  const DATA_KEY = "stock-trading-journal-dividends-v1";
  const ORDER_KEY = "stock-trading-journal-dividend-order-v1";
  const WATCHLIST_KEY = "stock-trading-journal-watchlist-v1";
  const $ = (id) => document.getElementById(id);
  const state = { data: {}, order: [], stocks: [], code: "" };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!$("dividend-page")) return;
    Object.assign(el, {
      sort: $("dividend-sort"), yearFilter: $("dividend-year-filter"),
      body: $("dividend-table-body"), empty: $("dividend-empty"),
      message: $("dividend-message"), dialog: $("dividend-dialog"),
      title: $("dividend-dialog-title"), close: $("dividend-dialog-close"),
      form: $("dividend-form"), year: $("dividend-year"),
      amount: $("dividend-amount"), note: $("dividend-note"),
      submit: $("dividend-submit"), cancel: $("dividend-cancel-edit"),
      dialogMessage: $("dividend-dialog-message"),
      records: $("dividend-records-body"),
      recordsEmpty: $("dividend-records-empty"),
      total: $("dividend-dialog-total")
    });
    state.data = read(DATA_KEY, {});
    state.order = read(ORDER_KEY, []);
    if (!state.data || Array.isArray(state.data) || typeof state.data !== "object") state.data = {};
    if (!Array.isArray(state.order)) state.order = [];

    el.sort.addEventListener("change", () => {
      el.yearFilter.disabled = !el.sort.value.startsWith("year-");
      renderList();
    });
    el.yearFilter.addEventListener("change", renderList);
    el.body.addEventListener("click", onStockAction);
    el.records.addEventListener("click", onRecordAction);
    el.form.addEventListener("submit", saveRecord);
    el.cancel.addEventListener("click", resetForm);
    el.close.addEventListener("click", closeDialog);
    el.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    el.dialog.addEventListener("click", (event) => {
      if (event.target === el.dialog) closeDialog();
    });
    document.addEventListener("app:pagechange", (event) => {
      if (event.detail?.pageId === "dividend-page") loadStocks();
    });
    fillYears();
  }

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn("localStorage 讀取失敗", error);
      return fallback;
    }
  }

  function write(key, value, target = el.message) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      message(target, "瀏覽器無法儲存資料，請確認 localStorage 可用且空間足夠。", "error");
      return false;
    }
  }

  async function loadStocks() {
    const map = new Map();
    message(el.message, "");
    try {
      if (window.StockDB?.getAllStocks) {
        (await window.StockDB.getAllStocks()).forEach((stock) => {
          const code = normalize(stock.stockCode);
          if (code) map.set(code, { code, name: String(stock.stockName || code).trim() });
        });
      }
    } catch (error) {
      message(el.message, "部分股票記帳資料暫時無法讀取，仍會顯示可用的自選股。", "error");
    }

    const watchlist = read(WATCHLIST_KEY, []);
    if (Array.isArray(watchlist)) {
      watchlist.forEach((stock) => {
        const code = normalize(stock.code);
        if (code) map.set(code, { code, name: String(stock.name || stock.stockName || code).trim() });
      });
    }

    state.stocks = Array.from(map.values());
    const known = new Set(state.order);
    state.stocks.forEach((stock) => {
      if (!known.has(stock.code)) {
        state.order.push(stock.code);
        known.add(stock.code);
      }
      if (state.data[stock.code] && state.data[stock.code].stockName !== stock.name) {
        state.data[stock.code].stockName = stock.name;
      }
    });
    write(ORDER_KEY, state.order);
    write(DATA_KEY, state.data);
    fillYears();
    renderList();
  }

  function normalize(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function fillYears() {
    const current = new Date().getFullYear();
    const selected = Number(el.yearFilter.value) || current;
    const years = new Set();
    for (let year = current + 1; year >= current - 10; year -= 1) years.add(year);
    Object.values(state.data).forEach((entry) => recordsOf(entry).forEach((record) => years.add(record.year)));
    el.yearFilter.innerHTML = Array.from(years).sort((a, b) => b - a)
      .map((year) => \`<option value="\${year}">\${year} 年</option>\`).join("");
    el.yearFilter.value = String(years.has(selected) ? selected : current);
  }

  function recordsOf(entry) {
    if (!entry || !Array.isArray(entry.dividends)) return [];
    return entry.dividends.map((record) => ({
      year: Number(record.year), amount: Number(record.amount), note: String(record.note || "")
    })).filter((record) =>
      Number.isInteger(record.year) && Number.isFinite(record.amount) && record.amount >= 0
    );
  }

  function records(code) {
    return recordsOf(state.data[code]).sort((a, b) => b.year - a.year);
  }

  function total(items) {
    return items.reduce((sum, record) => sum + record.amount, 0);
  }

  function format(value) {
    const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    return rounded.toLocaleString("zh-TW", {
      minimumFractionDigits: 0, maximumFractionDigits: 2
    });
  }

  function renderList() {
    const stocks = sortedStocks();
    el.empty.hidden = stocks.length > 0;
    const selectedYear = Number(el.yearFilter.value);
    el.body.innerHTML = stocks.map((stock) => {
      const items = records(stock.code);
      const latest = items[0];
      const annual = items.find((record) => record.year === selectedYear);
      const position = state.order.indexOf(stock.code);
      return \`
        <tr>
          <td data-label="股票代碼"><strong>\${escape(stock.code)}</strong></td>
          <td data-label="股票名稱">\${escape(stock.name)}</td>
          <td data-label="最近年度股息">\${latest ? \`\${latest.year} 年：\${format(latest.amount)} 元\` : '<span class="muted">尚無資料</span>'}</td>
          <td data-label="指定年度股息">\${annual ? \`\${format(annual.amount)} 元\` : '<span class="muted">尚無資料</span>'}</td>
          <td data-label="累積股息"><strong>\${format(total(items))} 元</strong></td>
          <td data-label="紀錄筆數">\${items.length}</td>
          <td data-label="操作" class="dividend-actions">
            <button type="button" class="secondary-btn compact-btn" data-action="open" data-code="\${escape(stock.code)}">查看／編輯</button>
            <button type="button" class="icon-btn order-btn" data-action="up" data-code="\${escape(stock.code)}" aria-label="上移 \${escape(stock.code)}" \${position <= 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="icon-btn order-btn" data-action="down" data-code="\${escape(stock.code)}" aria-label="下移 \${escape(stock.code)}" \${position < 0 || position >= state.stocks.length - 1 ? "disabled" : ""}>↓</button>
          </td>
        </tr>\`;
    }).join("");
  }

  function sortedStocks() {
    const list = [...state.stocks];
    const sort = el.sort.value;
    const year = Number(el.yearFilter.value);
    const positions = new Map(state.order.map((code, index) => [code, index]));
    const codeSort = (a, b) => {
      const x = Number(a), y = Number(b);
      return Number.isFinite(x) && Number.isFinite(y)
        ? x - y : a.localeCompare(b, "zh-Hant", { numeric: true });
    };
    if (sort === "manual") return list.sort((a, b) => (positions.get(a.code) ?? 1e9) - (positions.get(b.code) ?? 1e9));
    if (sort === "code-desc") return list.sort((a, b) => codeSort(b.code, a.code));
    if (sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    if (sort.startsWith("year-")) {
      return list.sort((a, b) => {
        const left = records(a.code).find((item) => item.year === year)?.amount;
        const right = records(b.code).find((item) => item.year === year)?.amount;
        if (left === undefined && right === undefined) return codeSort(a.code, b.code);
        if (left === undefined) return 1;
        if (right === undefined) return -1;
        return sort === "year-desc" ? right - left : left - right;
      });
    }
    if (sort.startsWith("total-")) {
      return list.sort((a, b) => {
        const left = total(records(a.code)), right = total(records(b.code));
        return sort === "total-desc" ? right - left : left - right;
      });
    }
    return list.sort((a, b) => codeSort(a.code, b.code));
  }

  function onStockAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const code = normalize(button.dataset.code);
    if (button.dataset.action === "open") openDialog(code);
    if (button.dataset.action === "up") move(code, -1);
    if (button.dataset.action === "down") move(code, 1);
  }

  function move(code, direction) {
    const visible = state.stocks.map((stock) => stock.code);
    const targetCode = visible[visible.indexOf(code) + direction];
    if (!targetCode) return;
    const from = state.order.indexOf(code), to = state.order.indexOf(targetCode);
    [state.order[from], state.order[to]] = [state.order[to], state.order[from]];
    if (write(ORDER_KEY, state.order)) {
      el.sort.value = "manual";
      el.yearFilter.disabled = true;
      renderList();
    }
  }

  function openDialog(code) {
    const stock = state.stocks.find((item) => item.code === code);
    if (!stock) return;
    state.code = code;
    el.title.textContent = \`\${code} \${stock.name}－股息紀錄\`;
    resetForm();
    renderRecords();
    if (typeof el.dialog.showModal === "function") el.dialog.showModal();
    else el.dialog.setAttribute("open", "");
    setTimeout(() => el.year.focus(), 0);
  }

  function closeDialog() {
    if (typeof el.dialog.close === "function" && el.dialog.open) el.dialog.close();
    else el.dialog.removeAttribute("open");
    state.code = "";
    resetForm();
  }

  function resetForm() {
    el.form.reset();
    el.form.dataset.originalYear = "";
    el.year.value = String(new Date().getFullYear());
    el.submit.textContent = "新增紀錄";
    el.cancel.hidden = true;
    message(el.dialogMessage, "");
  }

  function saveRecord(event) {
    event.preventDefault();
    const yearText = el.year.value.trim(), amountText = el.amount.value.trim();
    const year = Number(yearText), amount = Number(amountText);
    const maxYear = new Date().getFullYear() + 1;
    if (!yearText || !amountText) return message(el.dialogMessage, "請填寫年度與每股股息金額。", "error");
    if (!Number.isInteger(year) || year < 1900 || year > maxYear) {
      return message(el.dialogMessage, \`年度必須是 1900～\${maxYear} 的整數。`, "error");
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return message(el.dialogMessage, "每股股息必須是大於或等於 0 的數字。", "error");
    }

    const items = records(state.code);
    const originalYear = Number(el.form.dataset.originalYear);
    const editIndex = Number.isInteger(originalYear)
      ? items.findIndex((item) => item.year === originalYear) : -1;
    const duplicateIndex = items.findIndex((item) => item.year === year);
    if (duplicateIndex >= 0 && duplicateIndex !== editIndex) {
      if (!window.confirm(\`\${state.code} 已有 \${year} 年紀錄，是否更新原有紀錄？\`)) {
        return message(el.dialogMessage, "已取消，未建立重複年度紀錄。", "error");
      }
    }
    const kept = items.filter((item, index) => index !== editIndex && item.year !== year);
    kept.push({
      year,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      note: el.note.value.trim()
    });
    const stock = state.stocks.find((item) => item.code === state.code);
    state.data[state.code] = {
      stockName: stock?.name || state.data[state.code]?.stockName || state.code,
      dividends: kept.sort((a, b) => b.year - a.year)
    };
    if (!write(DATA_KEY, state.data, el.dialogMessage)) return;
    resetForm();
    message(el.dialogMessage, \`已儲存 \${year} 年股息紀錄。`, "success");
    fillYears();
    renderRecords();
    renderList();
  }

  function renderRecords() {
    const items = records(state.code);
    el.recordsEmpty.hidden = items.length > 0;
    el.records.innerHTML = items.map((record) => \`
      <tr>
        <td data-label="年度">\${record.year} 年</td>
        <td data-label="每股股息">\${format(record.amount)} 元</td>
        <td data-label="備註">\${record.note ? escape(record.note) : '<span class="muted">—</span>'}</td>
        <td data-label="操作" class="dividend-actions">
          <button type="button" class="secondary-btn compact-btn" data-record-action="edit" data-year="\${record.year}">編輯</button>
          <button type="button" class="danger-btn compact-btn" data-record-action="delete" data-year="\${record.year}">刪除</button>
        </td>
      </tr>\`).join("");
    el.total.textContent = \`\${format(total(items))} 元\`;
  }

  function onRecordAction(event) {
    const button = event.target.closest("button[data-record-action]");
    if (!button) return;
    const year = Number(button.dataset.year);
    if (button.dataset.recordAction === "edit") {
      const record = records(state.code).find((item) => item.year === year);
      if (!record) return;
      el.form.dataset.originalYear = String(year);
      el.year.value = String(year);
      el.amount.value = String(record.amount);
      el.note.value = record.note;
      el.submit.textContent = "儲存修改";
      el.cancel.hidden = false;
      message(el.dialogMessage, \`正在編輯 \${year} 年紀錄。`, "success");
      el.year.focus();
    }
    if (button.dataset.recordAction === "delete") deleteRecord(year);
  }

  function deleteRecord(year) {
    if (!window.confirm(\`確定刪除 \${state.code} 的 \${year} 年股息紀錄嗎？此操作無法復原。\`)) return;
    const entry = state.data[state.code];
    if (!entry) return;
    entry.dividends = records(state.code).filter((record) => record.year !== year);
    if (!write(DATA_KEY, state.data, el.dialogMessage)) return;
    resetForm();
    message(el.dialogMessage, \`已刪除 \${year} 年股息紀錄。`, "success");
    fillYears();
    renderRecords();
    renderList();
  }

  function message(target, text, type = "") {
    if (!target) return;
    target.textContent = text;
    target.className = \`form-message \${type}\`.trim();
    target.hidden = !text;
  }

  function escape(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
})();
