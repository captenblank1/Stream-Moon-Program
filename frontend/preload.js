// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAgentStatus: () => ipcRenderer.invoke("get-agent-status"),
  bindAgentSession: (token) => ipcRenderer.invoke("bind-agent-session", token),

  // ===== نظام Hotkey =====
  hotkey: {
    register: (combo, commandId, commandType) =>
      ipcRenderer.invoke("hotkey:register", combo, commandId, commandType),
    unregister: (combo) => ipcRenderer.invoke("hotkey:unregister", combo),
    unregisterAll: () => ipcRenderer.invoke("hotkey:unregisterAll"),
    onExecute: (callback) =>
      ipcRenderer.on("hotkey:execute", (_, data) => callback(data)),
  },
});