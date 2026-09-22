// ============================================================
// js/main.js — نقطة الدخول (ES6 Modules)
// يستورد موديولات التطبيق بترتيبها الأصلي ثم يعرض الدوال على
// window كما كانت في النسخة الكلاسيكية (لدعم معالجات HTML المضمنة)
// ============================================================
import "./config.js";
import "./state.js";
import "./utils-core.js";
import "./pairing.js";
import "./update-banner.js";
import "./captcha.js";
import "./auth-flow.js";
import "./live-status.js";
import "./profiles.js";
import "./rcon.js";
import "./storage.js";
import "./gifts.js";
import "./audio.js";
import "./video.js";
import "./commands.js";
import "./export-import.js";
import "./profile-share.js";
import "./tiktok.js";
import "./screens.js";
import "./admin.js";
import "./wins.js";
import "./overlay.js";
import "./hotkeys.js";
import "./init.js";
import "./misc.js";
import "./sidebar.js";
import "./socket.js";
// ✅ أقسام الإضافات: اللايف فيد + قراءة التعليقات + طلبات الأغاني
// (بعد sidebar.js كي تلفّ معالجات التنقل القديمة وتخفي الأقسام الجديدة)
import "./addons-nav.js";
import "./livefeed.js";
import "./tts.js";
import "./songs.js";
import "./viewerstats.js";
import "./streamer.js";
import "./misc2.js";
import "./boot-flow.js";
import "./extra-listeners.js";
import "./captcha-watch.js";
import "./notifications.js";

import { withButtonLock } from "./state.js";
import { getCookie, escapeHtml, decodeHtmlEntities, showMessage, showProSubscribedModal, waitForProActivation, getDeviceId, fetchWithAuth, showConfirm, safeImageUrl, safeMediaUrl } from "./utils-core.js";
import { checkPluginStatus, setPluginStatusUI, bindPluginStatusSocketListeners, getAuthToken, saveAuthToken, getSelectedProfileId, updateClearShortcutButton } from "./pairing.js";
import { ensureUpdateBanner, showUpdateBanner } from "./update-banner.js";
import { isElementVisible, isCaptchaVisible } from "./captcha.js";
import { bindAgent, updateAuthUI, withSectionSkeleton, withTableSkeleton, withHotkeySkeleton, _hotkeyListRun, withHotkeyChange } from "./auth-flow.js";
import { updateUIForDisconnected, checkLiveStatus } from "./live-status.js";
import { renderProfileSelect, loadProfilesData, loadProfiles, updateProfileName } from "./profiles.js";
import { loadRconConfig } from "./rcon.js";
import { updateStorageUI, checkStorageNotifications } from "./storage.js";
import { loadGifts, ensureGiftsLoaded, getGiftImage, updateGiftDropdown } from "./gifts.js";
import { loadAudios, deleteAudioFile } from "./audio.js";
import { deleteVideoFile } from "./video.js";
import { updateInputsForType, captureOriginalFormValues, hasFormChanged, checkForChangesAndClose, showAddCard, _showAddCard, hideAddCard, confirmAdd, loadCommands, _loadCommandsImpl, scheduleAutoSave, saveRowFromTr, moveRowUp, moveRowDown, executeCommand, _executeCommandImpl, deleteCommand, enableDragAndDrop } from "./commands.js";
import { buildCommandSelectionTable, buildDuplicateTable, refreshExistingCommands } from "./export-import.js";
import { loadCurrentProfileHotkeys, describeHotkeyCommand, buildHotkeySelectionTable, setupHotkeySelectAll, hideHotkeysSelectionArea, showExportModal, showImportModal, downloadJSON, fallbackDownload, showCopyProfileModal, showAddProfileFromFile } from "./profile-share.js";
import { performDisconnect, performConnect, showDisconnectConfirm, closeDisconnectModal, confirmDisconnect } from "./tiktok.js";
import { loadScreens } from "./screens.js";
import { buildAdminUserActionsHtml, buildAdminUserRowHtml, adminUserMatchesCurrentFilter, loadAdminDashboard, loadAdminNotifications, attachNotificationAdminEvents, showNotificationEditModal, handleEditNotification, handleDeleteNotification, attachAdminButtonEvents, openOverlayPanel, closeOverlayPanel } from "./admin.js";
import { initWinsPanel } from "./wins.js";
import { initOverlaysSection, initListsPanel } from "./overlay.js";
import { isValidHotkeyKey, hotkeyProfileQuery, loadHotkeySettings, saveHotkeySettingsToServer, updateHotkeyRegistration, applyHotkeySettings, clearHotkeyFormFields, showHotkeyStatus, saveHotkeySettings, loadHotkeyCommands, _loadHotkeyCommandsImpl, renderHotkeysList, _renderHotkeysListImpl, _renderHotkeysListNow, attachHotkeyToggleEvents, handleToggleChange, attachHotkeyDeleteEvents, attachHotkeyEditEvents, handleEditClick, handleDeleteClick, handleSaveShortcut, handleHotkeyFormKeydown, setupHotkeyEvents, initHotkey } from "./hotkeys.js";
import { cleanupFrontend, hideUploadProgress, init } from "./init.js";
import { setSelectedKeyboardKey, handleKeyClick, openKeyboardShortcutModal, closeKeyboardShortcutModal } from "./misc.js";
import { clearOverlayDashboard } from "./sidebar.js";
import { connectFrontendSocket, tryUnlockAudio } from "./socket.js";
import { updateStreamerImages, startStreamerUpdates } from "./streamer.js";
import { clearAudio, clearVideo, confirmDeleteAll, closeModal, deleteAll, safeJsonOrText, ensureProfileLoaded } from "./misc2.js";
import { renderPayPalButton, validatePasswordStrength, setupPasswordToggle, setBtnBusy } from "./boot-flow.js";
import { setupCaptchaWatcher, setupCustomSelects, closeAllDropdowns, handleSelectClick, handleOptionClick, closeCustomSelects } from "./captcha-watch.js";
import { getDismissedNotifications, addDismissedNotification, fetchAndShowNotification, ensureNotificationStack, removeNotificationBar, showNotification, showBlockScreen, forceSessionLogout, hideNotification, ensureContactLinksContainer, applyContactLinksVisibility, initContactLinks } from "./notifications.js";

Object.assign(globalThis, {
  withButtonLock,
  getCookie,
  escapeHtml,
  decodeHtmlEntities,
  showMessage,
  showProSubscribedModal,
  waitForProActivation,
  getDeviceId,
  fetchWithAuth,
  showConfirm,
  safeImageUrl,
  safeMediaUrl,
  checkPluginStatus,
  setPluginStatusUI,
  bindPluginStatusSocketListeners,
  getAuthToken,
  saveAuthToken,
  getSelectedProfileId,
  updateClearShortcutButton,
  ensureUpdateBanner,
  showUpdateBanner,
  isElementVisible,
  isCaptchaVisible,
  bindAgent,
  updateAuthUI,
  withSectionSkeleton,
  withTableSkeleton,
  withHotkeySkeleton,
  _hotkeyListRun,
  withHotkeyChange,
  updateUIForDisconnected,
  checkLiveStatus,
  renderProfileSelect,
  loadProfilesData,
  loadProfiles,
  updateProfileName,
  loadRconConfig,
  updateStorageUI,
  checkStorageNotifications,
  loadGifts,
  ensureGiftsLoaded,
  getGiftImage,
  updateGiftDropdown,
  loadAudios,
  deleteAudioFile,
  deleteVideoFile,
  updateInputsForType,
  captureOriginalFormValues,
  hasFormChanged,
  checkForChangesAndClose,
  showAddCard,
  _showAddCard,
  hideAddCard,
  confirmAdd,
  loadCommands,
  _loadCommandsImpl,
  scheduleAutoSave,
  saveRowFromTr,
  moveRowUp,
  moveRowDown,
  executeCommand,
  _executeCommandImpl,
  deleteCommand,
  enableDragAndDrop,
  buildCommandSelectionTable,
  buildDuplicateTable,
  refreshExistingCommands,
  loadCurrentProfileHotkeys,
  describeHotkeyCommand,
  buildHotkeySelectionTable,
  setupHotkeySelectAll,
  hideHotkeysSelectionArea,
  showExportModal,
  showImportModal,
  downloadJSON,
  fallbackDownload,
  showCopyProfileModal,
  showAddProfileFromFile,
  performDisconnect,
  performConnect,
  showDisconnectConfirm,
  closeDisconnectModal,
  confirmDisconnect,
  loadScreens,
  buildAdminUserActionsHtml,
  buildAdminUserRowHtml,
  adminUserMatchesCurrentFilter,
  loadAdminDashboard,
  loadAdminNotifications,
  attachNotificationAdminEvents,
  showNotificationEditModal,
  handleEditNotification,
  handleDeleteNotification,
  attachAdminButtonEvents,
  openOverlayPanel,
  closeOverlayPanel,
  initWinsPanel,
  initOverlaysSection,
  initListsPanel,
  isValidHotkeyKey,
  hotkeyProfileQuery,
  loadHotkeySettings,
  saveHotkeySettingsToServer,
  updateHotkeyRegistration,
  applyHotkeySettings,
  clearHotkeyFormFields,
  showHotkeyStatus,
  saveHotkeySettings,
  loadHotkeyCommands,
  _loadHotkeyCommandsImpl,
  renderHotkeysList,
  _renderHotkeysListImpl,
  _renderHotkeysListNow,
  attachHotkeyToggleEvents,
  handleToggleChange,
  attachHotkeyDeleteEvents,
  attachHotkeyEditEvents,
  handleEditClick,
  handleDeleteClick,
  handleSaveShortcut,
  handleHotkeyFormKeydown,
  setupHotkeyEvents,
  initHotkey,
  cleanupFrontend,
  hideUploadProgress,
  init,
  setSelectedKeyboardKey,
  handleKeyClick,
  openKeyboardShortcutModal,
  closeKeyboardShortcutModal,
  clearOverlayDashboard,
  connectFrontendSocket,
  tryUnlockAudio,
  updateStreamerImages,
  startStreamerUpdates,
  clearAudio,
  clearVideo,
  confirmDeleteAll,
  closeModal,
  deleteAll,
  safeJsonOrText,
  ensureProfileLoaded,
  renderPayPalButton,
  validatePasswordStrength,
  setupPasswordToggle,
  setBtnBusy,
  setupCaptchaWatcher,
  setupCustomSelects,
  closeAllDropdowns,
  handleSelectClick,
  handleOptionClick,
  closeCustomSelects,
  getDismissedNotifications,
  addDismissedNotification,
  fetchAndShowNotification,
  ensureNotificationStack,
  removeNotificationBar,
  showNotification,
  showBlockScreen,
  forceSessionLogout,
  hideNotification,
  ensureContactLinksContainer,
  applyContactLinksVisibility,
  initContactLinks
});
