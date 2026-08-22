// preload.js
const { contextBridge, ipcRenderer } = require("electron");

const electronAPI = {
  getAgentStatus: () => ipcRenderer.invoke("get-agent-status"),
  bindAgentSession: (token) => ipcRenderer.invoke("bind-agent-session", token),
  // فتح نافذة الدفع المعزولة (PayPal بدون صلاحيات Node)
  openPaymentWindow: (token) =>
    ipcRenderer.invoke("open-payment-window", token),

  // ===== نظام Hotkey =====
  hotkey: {
    register: (combo, commandId, commandType) =>
      ipcRenderer.invoke("hotkey:register", combo, commandId, commandType),
    unregister: (combo) => ipcRenderer.invoke("hotkey:unregister", combo),
    unregisterAll: () => ipcRenderer.invoke("hotkey:unregisterAll"),
    onExecute: (callback) =>
      ipcRenderer.on("hotkey:execute", (_, data) => callback(data)),
  },
};

// مع contextIsolation: false لا يعمل contextBridge - نرفق الواجهة مباشرة
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electronAPI", electronAPI);
  contextBridge.exposeInMainWorld("__APP_DIR", __dirname);
} else {
  window.electronAPI = electronAPI;
  // مسار مطلق لتحميل main.jsc - التحميل النسبي يعتمد على cwd ويفشل في النسخة المغلفة
  window.__APP_DIR = __dirname;
}
