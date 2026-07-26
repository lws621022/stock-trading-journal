
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firestore } from "./firebase-config.js";

const MAX_BATCH_WRITES = 400;
const CSV_HEADERS = ["stock_code", "stock_name", "year", "dividend", "note", "sort_order"];

function requireUid(uid) {
  if (!uid || typeof uid !== "string") throw createError("auth-required", "請先登入後再操作。");
  return uid;
}

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function validateStock(input) {
  const stockCode = normalizeCode(input?.stockCode ?? input?.code);
  const stockName = String(input?.stockName ?? input?.name ?? "").trim();
  const sortOrder = Number(input?.sortOrder);

  if (!stockCode) throw createError("invalid-stock-code", "股票代碼不可空白。");
  if (stockCode.length > 10 || !/^[0-9A-Z.-]+$/.test(stockCode)) {
    throw createError("invalid-stock-code", "股票代碼須為 1～10 位英數字、句點或連字號。");
  }
  if (!stockName) throw createError("invalid-stock-name", "股票名稱不可空白。");
  if (stockName.length > 80) throw createError("invalid-stock-name", "股票名稱不可超過 80 個字元。");
  if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 1000000) {\n    throw createError("invalid-sort-order", "股票排序值必須是 0～1000000 的數字。");\n  }

  return { stockCode, stockName, sortOrder };
}

export function validateDividend(input) {
  const year = Number(input?.year);
  const amount = Number(input?.amount);
  const note = String(input?.note ?? "");

  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw createError("invalid-year", "年度必須是 1900～2200 的整數。");
  }
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) {
    throw createError("invalid-amount", "每股股息必須是 0～100000 的數字。");
  }
  if (note.length > 200) throw createError("invalid-note", "備註不可超過 200 個字元。");

  return {
    year,
    amount: Math.round((amount + Number.EPSILON) * 100) / 100,
    note
  };
}

function stocksCollection(uid) {
  return collection(firestore, "users", requireUid(uid), "stocks");
}

function stockReference(uid, stockCode) {
  return doc(firestore, "users", requireUid(uid), "stocks", normalizeCode(stockCode));
}

function dividendsCollection(uid, stockCode) {
  return collection(firestore, "users", requireUid(uid), "stocks", normalizeCode(stockCode), "dividends");
}

function dividendReference(uid, stockCode, year) {
  return doc(firestore, "users", requireUid(uid), "stocks", normalizeCode(stockCode), "dividends", String(year));
}

function notifyDataChange(detail) {
  document.dispatchEvent(new CustomEvent("firebase:datachange", { detail }));
}

export async function getStocks(uid) {
  const snapshot = await getDocs(stocksCollection(uid));
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      stockCode: normalizeCode(data.stockCode || item.id),
      stockName: String(data.stockName || data.stockCode || item.id),
      sortOrder: Number(data.sortOrder)
    };
  }).filter((stock) => {
    try {
      validateStock(stock);
      return true;
    } catch {
      return false;
    }
  }).sort((a, b) => a.sortOrder - b.sortOrder
    || a.stockCode.localeCompare(b.stockCode, "zh-Hant", { numeric: true }));
}

export async function getStock(uid, stockCode) {
  const snapshot = await getDoc(stockReference(uid, stockCode));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return validateStock({
    stockCode: data.stockCode || snapshot.id,
    stockName: data.stockName,
    sortOrder: data.sortOrder
  });
}

export async function saveStock(uid, input) {
  const stock = validateStock(input);
  const reference = stockReference(uid, stock.stockCode);
  const snapshot = await getDoc(reference);
  const updatedAt = serverTimestamp();

  if (snapshot.exists()) {
    await setDoc(reference, {
      stockCode: stock.stockCode,
      stockName: stock.stockName,
      sortOrder: stock.sortOrder,
      updatedAt
    }, { merge: true });
  } else {
    await setDoc(reference, {
      ...stock,
      createdAt: updatedAt,
      updatedAt
    });
  }
  notifyDataChange({ type: "stocks", stockCode: stock.stockCode });
  return { stock, created: !snapshot.exists() };
}

export async function deleteStock(uid, stockCode) {
  const code = normalizeCode(stockCode);
  if (!code) throw createError("invalid-stock-code", "股票代碼不可空白。");
  // Firestore 刪除父文件不會刪除 dividends 子集合，可避免歷史股息被誤刪。
  await deleteDoc(stockReference(uid, code));
  notifyDataChange({ type: "stocks", stockCode: code });
}

export async function clearStocks(uid) {
  const stocks = await getStocks(uid);
  for (let offset = 0; offset < stocks.length; offset += MAX_BATCH_WRITES) {
    const batch = writeBatch(firestore);
    stocks.slice(offset, offset + MAX_BATCH_WRITES)
      .forEach((stock) => batch.delete(stockReference(uid, stock.stockCode)));
    await batch.commit();
  }
  notifyDataChange({ type: "stocks" });
}

export async function updateStockOrder(uid, orderedCodes) {
  const codes = [...new Set(orderedCodes.map(normalizeCode).filter(Boolean))];
  if (!codes.length) return;
  const batch = writeBatch(firestore);
  codes.forEach((code, index) => {
    batch.update(stockReference(uid, code), {
      sortOrder: index + 1,
      updatedAt: serverTimestamp()
    });
  });
  await batch.commit();
  notifyDataChange({ type: "stocks-order" });
}

export async function getDividends(uid, stockCode) {
  const snapshot = await getDocs(dividendsCollection(uid, stockCode));
  return snapshot.docs.map((item) => {
    try {
      return validateDividend(item.data());
    } catch {
      return null;
    }
  }).filter(Boolean).sort((a, b) => b.year - a.year);
}

export async function getAllData(uid) {
  const stocks = await getStocks(uid);
  const dividends = await Promise.all(stocks.map((stock) => getDividends(uid, stock.stockCode)));
  return stocks.map((stock, index) => ({ ...stock, dividends: dividends[index] }));
}

export async function saveDividend(uid, stockCode, input, options = {}) {
  const code = normalizeCode(stockCode);
  const dividend = validateDividend(input);
  const reference = dividendReference(uid, code, dividend.year);
  const snapshot = await getDoc(reference);

  if (snapshot.exists() && options.allowUpdate === false) {
    throw createError("duplicate-year", `${code} 已有 ${dividend.year} 年股息紀錄。`);
  }

  const updatedAt = serverTimestamp();
  if (snapshot.exists()) {
    await setDoc(reference, {
      year: dividend.year,
      amount: dividend.amount,
      note: dividend.note,
      updatedAt
    }, { merge: true });
  } else {
    await setDoc(reference, {
      ...dividend,
      createdAt: updatedAt,
      updatedAt
    });
  }
  notifyDataChange({ type: "dividends", stockCode: code, year: dividend.year });
  return { dividend, created: !snapshot.exists() };
}

export async function replaceDividendYear(uid, stockCode, originalYear, input, allowOverwrite = false) {
  const code = normalizeCode(stockCode);
  const dividend = validateDividend(input);
  const oldYear = Number(originalYear);
  if (!Number.isInteger(oldYear) || oldYear < 1900 || oldYear > 2200) {
    throw createError("invalid-year", "原始年度格式不正確。");
  }
  if (oldYear === dividend.year) {
    return saveDividend(uid, code, dividend, { allowUpdate: true });
  }

  const oldReference = dividendReference(uid, code, oldYear);
  const newReference = dividendReference(uid, code, dividend.year);
  const [oldSnapshot, newSnapshot] = await Promise.all([
    getDoc(oldReference),
    getDoc(newReference)
  ]);
  if (!oldSnapshot.exists()) throw createError("not-found", "找不到原本的股息紀錄。");
  if (newSnapshot.exists() && !allowOverwrite) {
    throw createError("duplicate-year", `${code} 已有 ${dividend.year} 年股息紀錄。`);
  }

  const batch = writeBatch(firestore);
  const updatedAt = serverTimestamp();
  const data = newSnapshot.exists()
    ? { year: dividend.year, amount: dividend.amount, note: dividend.note, updatedAt }
    : { ...dividend, createdAt: updatedAt, updatedAt };
  batch.set(newReference, data, { merge: newSnapshot.exists() });
  batch.delete(oldReference);
  await batch.commit();
  notifyDataChange({ type: "dividends", stockCode: code, year: dividend.year });
  return { dividend, created: !newSnapshot.exists() };
}

export async function deleteDividend(uid, stockCode, year) {
  const dividend = validateDividend({ year, amount: 0, note: "" });
  await deleteDoc(dividendReference(uid, stockCode, dividend.year));
  notifyDataChange({ type: "dividends", stockCode: normalizeCode(stockCode), year: dividend.year });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportCsv(uid) {
  const data = await getAllData(uid);
  const rows = [CSV_HEADERS.join(",")];
  data.forEach((stock) => {
    if (!stock.dividends.length) {
      rows.push([
        stock.stockCode, stock.stockName, "", "", "", stock.sortOrder
      ].map(csvEscape).join(","));
      return;
    }
    stock.dividends.forEach((dividend) => {
      rows.push([
        stock.stockCode,
        stock.stockName,
        dividend.year,
        dividend.amount,
        dividend.note,
        stock.sortOrder
      ].map(csvEscape).join(","));
    });
  });
  return `\uFEFF${rows.join("\r\n")}`;
}

function parseCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw createError("invalid-csv", "CSV 引號未正確結束。");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function valuesEqual(left, right) {
  return String(left ?? "") === String(right ?? "");
}

export async function importCsv(uid, text) {
  const rows = parseCsv(text);
  if (!rows.length) throw createError("invalid-csv", "CSV 檔案是空的。");
  const headers = rows.shift().map((value) => value.trim());
  if (headers.length !== CSV_HEADERS.length
    || !CSV_HEADERS.every((header, index) => headers[index] === header)) {
    throw createError("invalid-csv", `CSV 欄位必須依序為：${CSV_HEADERS.join(",")}`);
  }

  const stockInputs = new Map();
  const dividendInputs = new Map();
  const rowErrors = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    if (row.length !== CSV_HEADERS.length) {
      rowErrors.push(`第 ${line} 列欄位數量不正確`);
      return;
    }
    try {
      const stock = validateStock({
        stockCode: row[0],
        stockName: row[1],
        sortOrder: row[5]
      });
      stockInputs.set(stock.stockCode, stock);

      const hasDividend = [row[2], row[3], row[4]].some((value) => String(value).trim() !== "");
      if (hasDividend) {
        if (String(row[2]).trim() === "" || String(row[3]).trim() === "") {
          throw createError("invalid-dividend", "年度與股息金額必須同時填寫");
        }
        const dividend = validateDividend({ year: row[2], amount: row[3], note: row[4] });
        dividendInputs.set(`${stock.stockCode}:${dividend.year}`, { stockCode: stock.stockCode, ...dividend });
      }
    } catch (error) {
      rowErrors.push(`第 ${line} 列：${error.message}`);
    }
  });

  const existingData = await getAllData(uid);
  const existingStocks = new Map(existingData.map((stock) => [stock.stockCode, stock]));
  const existingDividends = new Map();
  existingData.forEach((stock) => stock.dividends.forEach((dividend) => {
    existingDividends.set(`${stock.stockCode}:${dividend.year}`, dividend);
  }));

  const operations = [];
  stockInputs.forEach((stock) => {
    const existing = existingStocks.get(stock.stockCode);
    if (existing && valuesEqual(existing.stockName, stock.stockName)
      && Number(existing.sortOrder) === stock.sortOrder) {
      return;
    }
    operations.push({
      kind: "stock",
      status: existing ? "updated" : "added",
      reference: stockReference(uid, stock.stockCode),
      data: existing
        ? { ...stock, updatedAt: serverTimestamp() }
        : { ...stock, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      merge: Boolean(existing)
    });
  });

  dividendInputs.forEach((dividend, key) => {
    const existing = existingDividends.get(key);
    if (existing && Number(existing.amount) === dividend.amount
      && valuesEqual(existing.note, dividend.note)) {
      return;
    }
    operations.push({
      kind: "dividend",
      status: existing ? "updated" : "added",
      reference: dividendReference(uid, dividend.stockCode, dividend.year),
      data: existing
        ? { year: dividend.year, amount: dividend.amount, note: dividend.note, updatedAt: serverTimestamp() }
        : { year: dividend.year, amount: dividend.amount, note: dividend.note,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      merge: Boolean(existing)
    });
  });

  const stats = {
    added: 0,
    updated: 0,
    skipped: Math.max(0, stockInputs.size + dividendInputs.size - operations.length),
    errors: rowErrors.length,
    details: [...rowErrors]
  };

  for (let offset = 0; offset < operations.length; offset += MAX_BATCH_WRITES) {
    const chunk = operations.slice(offset, offset + MAX_BATCH_WRITES);
    const batch = writeBatch(firestore);
    chunk.forEach((operation) => {
      batch.set(operation.reference, operation.data, { merge: operation.merge });
    });
    try {
      await batch.commit();
      chunk.forEach((operation) => { stats[operation.status] += 1; });
    } catch (error) {
      stats.errors += chunk.length;
      stats.details.push(`第 ${Math.floor(offset / MAX_BATCH_WRITES) + 1} 批寫入失敗，請確認網路與 Firestore 權限。`);
    }
  }

  if (operations.length) notifyDataChange({ type: "import" });
  return stats;
}

export function getFriendlyError(error, fallback = "操作失敗，請稍後再試。") {
  const code = String(error?.code || "");
  if (!navigator.onLine || code.includes("unavailable")) return "網路連線中斷，請恢復連線後再試。";
  if (code.includes("permission-denied")) return "沒有權限存取這份資料，請確認已登入並發布正確的 Firestore Rules。";
  if (code.includes("not-found")) return "找不到指定的資料，可能已在其他裝置刪除。";
  if (code.includes("duplicate-year")) return error.message;
  if (code.includes("invalid-") || code.includes("auth-required")) return error.message;
  return fallback;
}

export const FirebaseService = Object.freeze({
  validateStock,
  validateDividend,
  getStocks,
  getStock,
  saveStock,
  deleteStock,
  clearStocks,
  updateStockOrder,
  getDividends,
  getAllData,
  saveDividend,
  replaceDividendYear,
  deleteDividend,
  exportCsv,
  importCsv,
  getFriendlyError
});
