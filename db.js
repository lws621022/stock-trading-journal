// IndexedDB 存取集中於此，畫面程式不直接操作資料庫交易。
const StockDB = (() => {
  const DB_NAME = "my-taiwan-stock-database";
  const DB_VERSION = 1;
  const STORE_NAME = "stocks";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
          store.createIndex("stockCode", "stockCode", { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("資料庫升級被其他分頁阻擋，請關閉其他分頁後重試。"));
    });
  }

  async function useStore(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try { result = operation(store); } catch (error) { database.close(); reject(error); return; }
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error("資料庫操作已中止。")); };
    });
  }

  function addStock(stock) {
    return useStore("readwrite", (store) => {
      const record = { stockCode: stock.stockCode, stockName: stock.stockName, market: stock.market, type: stock.type, createdAt: new Date().toISOString() };
      const request = store.add(record);
      request.onsuccess = () => { record.id = request.result; };
      return record;
    });
  }

  async function getAllStocks() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  }

  async function stockExists(stockCode) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).index("stockCode").getKey(stockCode);
      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  }

  function deleteStock(id) { return useStore("readwrite", (store) => store.delete(id)); }
  function clearStocks() { return useStore("readwrite", (store) => store.clear()); }

  return Object.freeze({ openDatabase, addStock, getAllStocks, stockExists, deleteStock, clearStocks });
})();

