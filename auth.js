
const AUTH_CDN = "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
// 未來若只允許單一帳號，將登入後取得的 UID 填入此處即可。
const ALLOWED_UID = "";

let auth = null;
let googleProvider = null;
let FirebaseService = null;
let signInWithPopup = null;
let signOut = null;
let onAuthStateChanged = null;
let pendingAuthMessage = "";

window.FirebaseAuthState = { user: null, ready: false };

const elements = {
  gate: document.querySelector("#auth-gate"),
  login: document.querySelector("#google-login"),
  message: document.querySelector("#auth-message"),
  account: document.querySelector("#account-panel"),
  userName: document.querySelector("#auth-user-name"),
  userUid: document.querySelector("#auth-user-uid"),
  logout: document.querySelector("#auth-logout"),
  app: document.querySelector("#app"),
  footer: document.querySelector("footer")
};

function showAuthMessage(text, type = "warning") {
  elements.message.textContent = text;
  elements.message.className = `message ${type}`;
  elements.message.hidden = !text;
}

function getAuthErrorMessage(error) {
  const code = String(error?.code || "");
  if (!navigator.onLine || code === "auth/network-request-failed") {
    return "網路連線中斷，請恢復連線後再試。";
  }
  if (code === "auth/popup-blocked") {
    return "登入彈出視窗被瀏覽器封鎖，請允許彈出視窗後重試。";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "已取消 Google 登入。";
  }
  if (code === "auth/unauthorized-domain") {
    return "目前網域尚未加入 Firebase Authentication 授權網域。";
  }
  return "Google 登入失敗，請稍後再試。";
}

function dispatchAuthChange(user) {
  document.dispatchEvent(new CustomEvent("firebase:authchange", {
    detail: { user, service: FirebaseService }
  }));
}

function applySignedOutState(message = "") {
  window.FirebaseAuthState = { user: null, ready: true };
  elements.gate.hidden = false;
  elements.account.hidden = true;
  elements.app.hidden = true;
  elements.footer.hidden = true;
  elements.userName.textContent = "";
  elements.userUid.textContent = "";
  const visibleMessage = message || pendingAuthMessage;
  pendingAuthMessage = "";
  if (visibleMessage) showAuthMessage(visibleMessage, "error");
  else showAuthMessage("");
  dispatchAuthChange(null);
}

function applySignedInState(user) {
  window.FirebaseAuthState = { user, ready: true };
  elements.gate.hidden = true;
  elements.account.hidden = false;
  elements.app.hidden = false;
  elements.footer.hidden = false;
  elements.userName.textContent = user.displayName || user.email || "已登入使用者";
  elements.userUid.textContent = user.uid;
  showAuthMessage("");
  dispatchAuthChange(user);
}

elements.login.addEventListener("click", async () => {
  if (!auth || !signInWithPopup) {
    showAuthMessage("Firebase 尚未完成初始化，請重新整理後再試。", "error");
    return;
  }
  elements.login.disabled = true;
  elements.login.textContent = "登入中…";
  showAuthMessage("正在開啟 Google 登入視窗…", "warning");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    showAuthMessage(getAuthErrorMessage(error), "error");
  } finally {
    elements.login.disabled = false;
    elements.login.textContent = "使用 Google 帳號登入";
  }
});

elements.logout.addEventListener("click", async () => {
  if (!auth || !signOut) return;
  elements.logout.disabled = true;
  elements.logout.textContent = "登出中…";
  try {
    await signOut(auth);
  } catch (error) {
    const target = document.querySelector("#global-message");
    target.textContent = "登出失敗，請稍後再試。";
    target.className = "message error";
    target.hidden = false;
  } finally {
    elements.logout.disabled = false;
    elements.logout.textContent = "登出";
  }
});

async function initializeFirebase() {
  try {
    const [configModule, serviceModule, authModule] = await Promise.all([
      import("./firebase-config.js"),
      import("./firebase-service.js"),
      import(AUTH_CDN)
    ]);
    auth = configModule.auth;
    googleProvider = configModule.googleProvider;
    FirebaseService = serviceModule.FirebaseService;
    signInWithPopup = authModule.signInWithPopup;
    signOut = authModule.signOut;
    onAuthStateChanged = authModule.onAuthStateChanged;
    window.FirebaseService = FirebaseService;

    await configModule.initializeAuthPersistence();
    onAuthStateChanged(auth, async (user) => {
      if (user && ALLOWED_UID && user.uid !== ALLOWED_UID) {
        pendingAuthMessage = "此 Google 帳號未獲授權使用本系統。";
        await signOut(auth);
        return;
      }
      if (user) applySignedInState(user);
      else applySignedOutState();
    }, (error) => {
      console.error("Firebase 登入狀態檢查失敗", error);
      applySignedOutState("無法檢查登入狀態，請重新整理後再試。");
    });
  } catch (error) {
    console.error("Firebase 初始化失敗", error);
    elements.login.disabled = true;
    applySignedOutState("Firebase 初始化失敗，請確認設定、網路連線與 CDN 是否可用。");
  }
}

initializeFirebase();
