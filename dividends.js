
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    uid: "",
    service: null,
    stocks: [],
    dividends: new Map(),
    code: "",
    savingOrder: false
  };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!$("dividend-page")) return;
    Object.assign(el, {
      page: $("dividend-page"),
      sort: $("dividend-sort"),
      yearFilter: $("dividend-year-filter"),
      body: $("dividend-table-body"),
      empty: $("dividend-empty"),
      message: $("dividend-message"),
      dialog: $("dividend-dialog"),
      title: $("dividend-dialog-title"),
      close: $("dividend-dialog-close"),
      form: $("dividend-form"),
      year: $("dividend-year"),
      amount: $("dividend-amount"),
      note: $("dividend-note"),
      submit: $("dividend-submit"),
      cancel: $("dividend-cancel-edit"),
      dialogMessage: $("dividend-dialog-message"),
      records: $("dividend-records-body"),
      recordsEmpty: $("dividend-records-empty"),
      total: $("dividend-dialog-total")
    });

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
      if (event.detail?.pageId === "dividend-page") loadData();
    });
    document.addEventListener("firebase:authchange", async (event) => {
      state.uid = event.detail?.user?.uid || "";
      state.service = event.detail?.service || window.FirebaseService || null;
      if (!state.uid) {
        clearData();
        closeDialog();
        return;
      }
      await loadData();
    });

    if (window.FirebaseAuthState?.ready && window.FirebaseAuthState.user) {
      state.uid = window.FirebaseAuthState.user.uid;
      state.service = window.FirebaseService;
    }
    fillYears();
    renderList();
  }

  function clearData() {
    state.stocks = [];
    state.dividends = new Map();
    state.code = "";
    renderList();
    message(el.message, "");
  }

  async function loadData() {
    if (!state.uid || !state.service) {
      clearData();
      return;
    }
    message(el.message, "載入 Firebase 股息資料中…", "warning");
    try {
      const stocks = await state.service.getStocks(state.uid);
      const dividendLists = await Promise.all(
        stocks.map((stock) => state.service.getDividends(state.uid, stock.stockCode))
      );
      state.stocks = stocks;
      state.dividends = new Map(
        stocks.map((stock, index) => [stock.stockCode, dividendLists[index]])
      );
      fillYears();
      renderList();
      if (state.code) renderRecords();
      message(el.message, "");
    } catch (error) {
      message(el.message, state.service.getFriendlyError(error, "無法載入 Firebase 股息資料。"), "error");
    }
  }

  function fillYears() {
    const current = new Date().getFullYear();
    const selected = Number(el.yearFilter.value) || current;
    const years = new Set();
    for (let year = current + 1; year >= current - 10; year -= 1) years.add(year);
    state.dividends.forEach((items) => items.forEach((record) => years.add(record.year)));
    el.yearFilter.innerHTML = Array.from(years).sort((a, b) => b - a)
      .map((year) => `<option value="${year}">${year} 年</option>`).join("");
    el.yearFilter.value = String(years.has(selected) ? selected : current);
  }

  function records(code) {
    return [...(state.dividends.get(code) || [])].sort((a, b) => b.year - a.year);
  }

  function total(items) {
    return items.reduce((sum, record) => sum + record.amount, 0);
  }

  function format(value) {
    const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    return rounded.toLocaleString("zh-TW", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  function renderList() {
    const stocks = sortedStocks();
    el.empty.hidden = stocks.length > 0;
    const selectedYear = Number(el.yearFilter.value);
    const manualStocks = [...state.stocks].sort((a, b) => a.sortOrder - b.sortOrder);
    el.body.innerHTML = stocks.map((stock) => {
      const items = records(stock.stockCode);
      const latest = items[0];
      const annual = items.find((record) => record.year === selectedYear);
      const position = manualStocks.findIndex((item) => item.stockCode === stock.stockCode);
      return `
        <tr>
          <td data-label="股票代碼"><strong>${escape(stock.stockCode)}</strong></td>
          <td data-label="股票名稱">${escape(stock.stockName)}</td>
          <td data-label="最近年度股息">${latest
            ? `${latest.year} 年：${format(latest.amount)} 元`
            : '<span class="muted">尚無資料</span>'}</td>
          <td data-label="指定年度股息">${annual
            ? `${format(annual.amount)} 元`
            : '<span class="muted">尚無資料</span>'}</td>
          <td data-label="累積股息"><strong>${format(total(items))} 元</strong></td>
          <td data-label="紀錄筆數">${items.length}</td>
          <td data-label="操作" class="dividend-actions">
            <button type="button" class="secondary-btn compact-btn"
              data-action="open" data-code="${escape(stock.stockCode)}">查看／編輯</button>
            <button type="button" class="icon-btn order-btn" data-action="up"
              data-code="${escape(stock.stockCode)}" aria-label="上移 ${escape(stock.stockCode)}"
              ${position <= 0 || state.savingOrder ? "disabled" : ""}>↑</button>
            <button type="button" class="icon-btn order-btn" data-action="down"
              data-code="${escape(stock.stockCode)}" aria-label="下移 ${escape(stock.stockCode)}"
              ${position < 0 || position >= manualStocks.length - 1 || state.savingOrder ? "disabled" : ""}>↓</button>
          </td>
        </tr>`;
    }).join("");
  }

  function sortedStocks() {
    const list = [...state.stocks];
    const sort = el.sort.value;
    const year = Number(el.yearFilter.value);
    const codeSort = (a, b) => a.localeCompare(b, "zh-Hant", { numeric: true });

    if (sort === "manual") return list.sort((a, b) => a.sortOrder - b.sortOrder);
    if (sort === "code-desc") return list.sort((a, b) => codeSort(b.stockCode, a.stockCode));
    if (sort === "name") return list.sort((a, b) => a.stockName.localeCompare(b.stockName, "zh-Hant"));
    if (sort.startsWith("year-")) {
      return list.sort((a, b) => {
        const left = records(a.stockCode).find((item) => item.year === year)?.amount;
        const right = records(b.stockCode).find((item) => item.year === year)?.amount;
        if (left === undefined && right === undefined) return codeSort(a.stockCode, b.stockCode);
        if (left === undefined) return 1;
        if (right === undefined) return -1;
        return sort === "year-desc" ? right - left : left - right;
      });
    }
    if (sort.startsWith("total-")) {
      return list.sort((a, b) => {
        const left = total(records(a.stockCode));
        const right = total(records(b.stockCode));
        return sort === "total-desc" ? right - left : left - right;
      });
    }
    return list.sort((a, b) => codeSort(a.stockCode, b.stockCode));
  }

  function onStockAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const code = String(button.dataset.code || "").trim().toUpperCase();
    if (button.dataset.action === "open") openDialog(code);
    if (button.dataset.action === "up") move(code, -1);
    if (button.dataset.action === "down") move(code, 1);
  }

  async function move(code, direction) {
    if (!state.uid || !state.service || state.savingOrder) return;
    const manualStocks = [...state.stocks].sort((a, b) => a.sortOrder - b.sortOrder);
    const from = manualStocks.findIndex((stock) => stock.stockCode === code);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= manualStocks.length) return;
    [manualStocks[from], manualStocks[to]] = [manualStocks[to], manualStocks[from]];
    state.savingOrder = true;
    el.sort.value = "manual";
    el.yearFilter.disabled = true;
    renderList();
    try {
      await state.service.updateStockOrder(state.uid, manualStocks.map((stock) => stock.stockCode));
      manualStocks.forEach((stock, index) => { stock.sortOrder = index + 1; });
      state.stocks = manualStocks;
      message(el.message, "自訂順序已同步至 Firebase。", "success");
    } catch (error) {
      message(el.message, state.service.getFriendlyError(error, "自訂順序儲存失敗。"), "error");
      await loadData();
    } finally {
      state.savingOrder = false;
      renderList();
    }
  }

  function openDialog(code) {
    const stock = state.stocks.find((item) => item.stockCode === code);
    if (!stock) return;
    state.code = code;
    el.title.textContent = `${code} ${stock.stockName}－股息紀錄`;
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

  function setFormSaving(saving) {
    [...el.form.elements].forEach((control) => { control.disabled = saving; });
    el.submit.textContent = saving ? "儲存中…" : (el.form.dataset.originalYear ? "儲存修改" : "新增紀錄");
  }

  async function saveRecord(event) {
    event.preventDefault();
    if (!state.uid || !state.service || !state.code) return;

    let dividend;
    try {
      dividend = state.service.validateDividend({
        year: el.year.value.trim(),
        amount: el.amount.value.trim(),
        note: el.note.value
      });
    } catch (error) {
      message(el.dialogMessage, error.message, "error");
      return;
    }

    const originalYearText = el.form.dataset.originalYear;
    const originalYear = originalYearText ? Number(originalYearText) : null;
    const targetExists = records(state.code).some((record) => record.year === dividend.year);
    let allowUpdate = originalYear === dividend.year;

    if (targetExists && originalYear !== dividend.year) {
      allowUpdate = window.confirm(
        `${state.code} 已有 ${dividend.year} 年股息紀錄，是否更新原有紀錄？`
      );
      if (!allowUpdate) {
        message(el.dialogMessage, "已取消，未建立重複年度紀錄。", "warning");
        return;
      }
    }

    setFormSaving(true);
    try {
      if (originalYear !== null) {
        await state.service.replaceDividendYear(
          state.uid, state.code, originalYear, dividend, allowUpdate
        );
      } else {
        await state.service.saveDividend(
          state.uid, state.code, dividend, { allowUpdate }
        );
      }
      await loadData();
      resetForm();
      message(el.dialogMessage, `已儲存 ${dividend.year} 年股息紀錄。`, "success");
      renderRecords();
    } catch (error) {
      const text = String(error?.code || "").includes("duplicate-year")
        ? `${error.message} 請改用該年度的「編輯」按鈕。`
        : state.service.getFriendlyError(error, "股息儲存失敗。");
      message(el.dialogMessage, text, "error");
    } finally {
      setFormSaving(false);
    }
  }

  function renderRecords() {
    const items = records(state.code);
    el.recordsEmpty.hidden = items.length > 0;
    el.records.innerHTML = items.map((record) => `
      <tr>
        <td data-label="年度">${record.year} 年</td>
        <td data-label="每股股息">${format(record.amount)} 元</td>
        <td data-label="備註">${record.note ? escape(record.note) : '<span class="muted">—</span>'}</td>
        <td data-label="操作" class="dividend-actions">
          <button type="button" class="secondary-btn compact-btn"
            data-record-action="edit" data-year="${record.year}">編輯</button>
          <button type="button" class="danger-btn compact-btn"
            data-record-action="delete" data-year="${record.year}">刪除</button>
        </td>
      </tr>`).join("");
    el.total.textContent = `${format(total(items))} 元`;
  }

  function onRecordAction(event) {
    const button = event.target.closest("button[data-record-action]");
    if (!button) return;
    const year = Number(button.dataset.year);
    if (button.dataset.recordAction === "edit") editRecord(year);
    if (button.dataset.recordAction === "delete") deleteRecord(year, button);
  }

  function editRecord(year) {
    const record = records(state.code).find((item) => item.year === year);
    if (!record) return;
    el.form.dataset.originalYear = String(year);
    el.year.value = String(year);
    el.amount.value = String(record.amount);
    el.note.value = record.note;
    el.submit.textContent = "儲存修改";
    el.cancel.hidden = false;
    message(el.dialogMessage, `正在編輯 ${year} 年紀錄。`, "success");
    el.year.focus();
  }

  async function deleteRecord(year, button) {
    if (!window.confirm(`確定刪除 ${state.code} 的 ${year} 年股息紀錄嗎？此操作無法復原。`)) return;
    button.disabled = true;
    try {
      await state.service.deleteDividend(state.uid, state.code, year);
      await loadData();
      resetForm();
      message(el.dialogMessage, `已刪除 ${year} 年股息紀錄。`, "success");
      renderRecords();
    } catch (error) {
      message(el.dialogMessage, state.service.getFriendlyError(error, "股息刪除失敗。"), "error");
      button.disabled = false;
    }
  }

  function message(target, text, type = "") {
    if (!target) return;
    target.textContent = text;
    target.className = `message ${type}`.trim();
    target.hidden = !text;
  }

  function escape(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
})();
