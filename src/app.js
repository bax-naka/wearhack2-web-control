import {
  SERVICE_UUID, COMMAND_UUID, NOTIFY_UUID, STATUS_REQUEST,
  MIN_TEMPERATURE, MAX_TEMPERATURE, MIN_DURATION, MAX_DURATION,
  EXTENDED_MIN_TEMPERATURE, EXTENDED_MAX_TEMPERATURE, EXTENDED_MAX_DURATION,
  requiresExtendedRange, parseStatus, isSettingsAck, buildSettingsCommand, formatRemaining, formatHex
} from "./protocol.js";

const $ = (id) => document.getElementById(id);
const ui = {
  connect: $("connect-button"), disconnect: $("disconnect-button"),
  refresh: $("refresh-button"), connection: $("connection-state"),
  name: $("device-name"), message: $("connection-message"),
  temperature: $("temperature"), remaining: $("remaining"), power: $("power"),
  updated: $("updated-at"), lastPacket: $("last-packet"),
  targetTemperature: $("target-temperature"),
  targetTemperatureRange: $("target-temperature-range"),
  targetDuration: $("target-duration"),
  targetDurationRange: $("target-duration-range"),
  powerOn: $("power-on-button"), powerOff: $("power-off-button"),
  apply: $("apply-button"), controlMessage: $("control-message"),
  lastCommand: $("last-command"),
  safetyLock: $("safety-lock-button"),
  safetyPanel: $("safety-lock-panel"),
  safetyModeDescription: $("safety-mode-description"),
  safetyWarning: $("safety-mode-warning")
};
const storageKey = "wearhack2-web-control-settings-v1";
const state = {
  device: null, command: null, notify: null, interval: null,
  lastStatusAt: 0, lastStatus: null, connecting: false,
  actionBusy: false, pendingAck: null, pendingStatus: null,
  safetyUnlocked: false
};

function showMessage(message, isError = false) {
  ui.message.textContent = message;
  ui.message.classList.toggle("error", isError);
}
function showControlMessage(message, isError = false) {
  ui.controlMessage.textContent = message;
  ui.controlMessage.classList.toggle("error", isError);
}
function setConnection(label, className) {
  ui.connection.textContent = label;
  ui.connection.className = "state-pill " + className;
}
function connected() {
  return !!(state.device?.gatt?.connected && state.command && state.notify);
}
function selectedSettings() {
  const temperature = Number(ui.targetTemperature.value);
  const durationMinutes = Number(ui.targetDuration.value);
  const minTemp = state.safetyUnlocked ? EXTENDED_MIN_TEMPERATURE : MIN_TEMPERATURE;
  const maxTemp = state.safetyUnlocked ? EXTENDED_MAX_TEMPERATURE : MAX_TEMPERATURE;
  const maxDuration = state.safetyUnlocked ? EXTENDED_MAX_DURATION : MAX_DURATION;
  // An empty number input must not silently become 0.
  if (ui.targetTemperature.value.trim() === "" || !Number.isInteger(temperature) ||
      temperature < minTemp || temperature > maxTemp) {
    throw new RangeError(`目標温度は${minTemp}〜${maxTemp}℃の整数で入力してください`);
  }
  if (ui.targetDuration.value.trim() === "" || !Number.isInteger(durationMinutes) ||
      durationMinutes < MIN_DURATION || durationMinutes > maxDuration) {
    throw new RangeError(`タイマーは1〜${maxDuration}分の整数で入力してください`);
  }
  return {temperature, durationMinutes};
}
function selectedSettingsValid() {
  try { selectedSettings(); return true; }
  catch { return false; }
}
function updateButtons() {
  const usable = connected() && !state.actionBusy && !!state.lastStatus;
  const valid = selectedSettingsValid();
  ui.connect.disabled = state.connecting || connected();
  ui.connect.textContent = state.device ? "再接続" : "機器を選択して接続";
  ui.disconnect.disabled = !connected();
  ui.refresh.disabled = !connected() || state.actionBusy;
  ui.safetyLock.disabled = state.actionBusy || state.connecting;
  ui.powerOn.disabled = !usable || !valid;
  ui.powerOff.disabled = !usable; // Stopping must not depend on valid form input.
  ui.apply.disabled = !usable || !valid || !state.lastStatus.powerOn;
}

function storeDraft() {
  try {
    const draft = selectedSettings();
    // Never persist values that require a new explicit safety unlock after a reload.
    if (!requiresExtendedRange(draft)) {
      localStorage.setItem(storageKey, JSON.stringify(draft));
    }
  } catch { /* No valid normal draft or browser storage may be disabled. */ }
}
function loadDraft() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (Number.isInteger(data.temperature) && data.temperature >= MIN_TEMPERATURE && data.temperature <= MAX_TEMPERATURE) {
      ui.targetTemperature.value = String(data.temperature);
    }
    if (Number.isInteger(data.durationMinutes) && data.durationMinutes >= MIN_DURATION && data.durationMinutes <= MAX_DURATION) {
      ui.targetDuration.value = String(data.durationMinutes);
    }
  } catch { /* No saved settings. */ }
  ui.targetTemperatureRange.value = ui.targetTemperature.value;
  ui.targetDurationRange.value = ui.targetDuration.value;
}

function setSafetyUnlocked(unlocked) {
  state.safetyUnlocked = unlocked;
  const minTemp = unlocked ? EXTENDED_MIN_TEMPERATURE : MIN_TEMPERATURE;
  const maxTemp = unlocked ? EXTENDED_MAX_TEMPERATURE : MAX_TEMPERATURE;
  const maxDuration = unlocked ? EXTENDED_MAX_DURATION : MAX_DURATION;
  for (const el of [ui.targetTemperature, ui.targetTemperatureRange]) {
    el.min = String(minTemp);
    el.max = String(maxTemp);
  }
  for (const el of [ui.targetDuration, ui.targetDurationRange]) {
    el.min = String(MIN_DURATION);
    el.max = String(maxDuration);
  }
  if (!unlocked) {
    // Relocking does not send anything to the device. It only limits new input.
    const clamp = (value, min, max, fallback) => {
      if (value.trim() === "") return fallback;
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };
    ui.targetTemperature.value = String(clamp(ui.targetTemperature.value, minTemp, maxTemp, 40));
    ui.targetDuration.value = String(clamp(ui.targetDuration.value, MIN_DURATION, maxDuration, 15));
  }
  ui.targetTemperatureRange.value = ui.targetTemperature.value;
  ui.targetDurationRange.value = ui.targetDuration.value;
  ui.safetyLock.setAttribute("aria-pressed", String(unlocked));
  ui.safetyLock.textContent = unlocked ? "再ロックする" : "ロックを解除";
  ui.safetyPanel.classList.toggle("unlocked", unlocked);
  ui.safetyModeDescription.textContent = unlocked
    ? "解除中：25～60℃ / 1～150分" : "ロック中：30～55℃ / 1～120分";
  ui.safetyWarning.hidden = !unlocked;
  if (!unlocked) storeDraft();
  updateButtons();
}

function connectSettingsFields(number, range) {
  range.addEventListener("input", () => {
    number.value = range.value;
    storeDraft();
    updateButtons();
  });
  number.addEventListener("input", () => {
    const value = Number(number.value);
    if (number.value !== "" && Number.isFinite(value)) range.value = String(value);
    if (selectedSettingsValid()) storeDraft();
    updateButtons();
  });
}
function clearReadings() {
  state.lastStatus = null;
  state.lastStatusAt = 0;
  ui.temperature.textContent = "--";
  ui.remaining.textContent = "--:--";
  ui.power.textContent = "不明";
  ui.power.className = "reading-value power-value";
  ui.updated.textContent = "最終取得：未取得";
  ui.lastPacket.textContent = "未受信";
  updateButtons();
}
function failWaiter(key, error) {
  const waiter = state[key];
  if (!waiter) return;
  clearTimeout(waiter.timer);
  state[key] = null;
  waiter.reject(error);
}
function resolveWaiter(key, data) {
  const waiter = state[key];
  if (!waiter) return;
  clearTimeout(waiter.timer);
  state[key] = null;
  waiter.resolve(data);
}
function createWaiter(key, timeoutMs, timeoutMessage) {
  if (state[key]) throw new Error("前の通信が完了していません");
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  promise.catch(() => {}); // Prevent unhandled rejection during a disconnect.
  const waiter = {promise, resolve, reject, timer: null};
  state[key] = waiter;
  waiter.timer = setTimeout(() => failWaiter(key, new Error(timeoutMessage)), timeoutMs);
  return waiter;
}
function stopPolling() {
  if (state.interval !== null) clearInterval(state.interval);
  state.interval = null;
}
function handleDisconnect() {
  stopPolling();
  setSafetyUnlocked(false);
  failWaiter("pendingAck", new Error("Bluetooth接続が切れました"));
  failWaiter("pendingStatus", new Error("Bluetooth接続が切れました"));
  state.command = null;
  state.notify = null;
  setConnection("未接続", "offline");
  clearReadings();
  showMessage("接続が切れました。「再接続」から接続し直してください。");
  showControlMessage("切断されたため、操作結果を確認できません。", true);
  updateButtons();
}
function handleNotification(event) {
  const view = event.target.value;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  ui.lastPacket.textContent = formatHex(bytes);
  try {
    if (isSettingsAck(bytes)) {
      resolveWaiter("pendingAck", true);
      return;
    }
    const status = parseStatus(bytes);
    if (!status) return;
    state.lastStatus = status;
    state.lastStatusAt = Date.now();
    ui.temperature.textContent = String(status.temperature);
    ui.remaining.textContent = formatRemaining(status);
    ui.power.textContent = status.powerOn ? "ON" : "OFF";
    ui.power.className = "reading-value power-value " + (status.powerOn ? "on" : "off");
    ui.updated.textContent = "最終取得：" + new Date(state.lastStatusAt).toLocaleTimeString("ja-JP");
    resolveWaiter("pendingStatus", status);
    if (!state.actionBusy) showMessage("本体の状態を取得しました。");
    updateButtons();
  } catch (error) {
    showMessage("受信データを解釈できません：" + error.message, true);
  }
}

async function requestStatus() {
  if (!connected()) throw new Error("未接続です");
  if (state.pendingStatus) return state.pendingStatus.promise;
  const waiter = createWaiter("pendingStatus", 3500, "状態応答がありませんでした");
  try {
    await state.command.writeValueWithoutResponse(STATUS_REQUEST);
  } catch (error) {
    failWaiter("pendingStatus", error);
  }
  return waiter.promise;
}
async function refreshStatus() {
  if (!connected() || state.actionBusy) return;
  try {
    await requestStatus();
  } catch (error) {
    if (connected()) showMessage("状態取得に失敗しました：" + error.message, true);
  }
}

async function sendSettings(mode) {
  if (!connected() || state.actionBusy) return;
  let settings;
  let useSafeOffFallback = false;
  try {
    settings = selectedSettings();
  } catch (error) {
    if (mode !== "off") {
      showControlMessage(error.message, true);
      return;
    }
    // Keep OFF available despite invalid input by using a known normal setpoint.
    settings = {temperature: 40, durationMinutes: 15};
    useSafeOffFallback = true;
  }
  // OFF never leaves experimental settings as the stored last settings.
  // A subsequent physical-button start can reuse the last command's parameters.
  if (mode === "off" && requiresExtendedRange(settings)) {
    settings = {temperature: 40, durationMinutes: 15};
    useSafeOffFallback = true;
  }
  if (!state.lastStatus) {
    showControlMessage("本体の状態を取得してから操作してください。", true);
    return;
  }
  if (mode === "apply" && !state.lastStatus.powerOn) return;
  if (requiresExtendedRange(settings)) {
    if (!state.safetyUnlocked) {
      showControlMessage("この設定にはセーフティーロック解除が必要です。", true);
      return;
    }
    // OFF remains immediately available; never delay stopping to show a dialog.
    if (mode !== "off" && !window.confirm(
      `仕様外設定 ${settings.temperature}℃ / ${settings.durationMinutes}分を送信します。\n` +
      "メーカー公称範囲外の運転は火傷・過熱の恐れがあります。身体に装着せず、停止手段を確保していますか？"
    )) return;
  }

  state.actionBusy = true;
  updateButtons();
  showControlMessage(useSafeOffFallback
    ? "停止を送信中です。拡張値を残さないよう40℃・15分・OFFで送信します。"
    : "送信中です。ACKと本体状態を確認します。");
  try {
    if (state.pendingStatus) await state.pendingStatus.promise;
    if (!connected()) throw new Error("Bluetooth接続が切れました");
    if (Date.now() - state.lastStatusAt > 12000) await requestStatus();

    const desiredPower = mode === "apply" ? state.lastStatus.powerOn : mode === "on";
    const bytes = buildSettingsCommand({...settings, powerOn: desiredPower, allowExtended: state.safetyUnlocked});
    const waiter = createWaiter("pendingAck", 3500, "設定コマンドのACKを受信できませんでした");
    try {
      await state.command.writeValueWithoutResponse(bytes);
    } catch (error) {
      failWaiter("pendingAck", error);
    }
    await waiter.promise;
    ui.lastCommand.textContent = "最後の設定送信（ACKあり）：" + formatHex(bytes);
    showControlMessage("ACKを受信しました。本体状態を照合しています。");
    try {
      const response = await requestStatus();
      if (response.powerOn === desiredPower) {
        const powerLabel = desiredPower ? "ON" : "OFF";
        showControlMessage("本体の電源" + powerLabel + "を確認しました。" +
          (useSafeOffFallback ? "40℃・15分・OFFを送信しています。" : "") +
          "目標温度は本体から読み戻せないため、設定値の反映はACKに基づく判断です。");
      } else {
        showControlMessage("ACKは受信しましたが、要求した電源状態と本体状態が一致しません。再送前に本体を確認してください。", true);
      }
    } catch (error) {
      showControlMessage("ACKは受信しましたが、状態の再取得はできませんでした（" + error.message + "）。本体を確認してください。", true);
    }
  } catch (error) {
    showControlMessage("操作結果は未確定です：" + error.message + "。自動再送はしません。本体の状態を確認してください。", true);
  } finally {
    state.actionBusy = false;
    updateButtons();
  }
}

async function connect() {
  if (state.connecting || connected()) return;
  if (!window.isSecureContext || !navigator.bluetooth) {
    showMessage("Web Bluetoothを利用できません。Android ChromeでHTTPSのページを開いてください。", true);
    return;
  }
  // A new connection attempt must always begin with the normal guarded range.
  setSafetyUnlocked(false);
  state.connecting = true;
  setConnection("接続中", "connecting");
  showMessage("WEARHACK2への接続を開始します。");
  updateButtons();
  try {
    if (!state.device) {
      // Must execute as part of a user click gesture.
      state.device = await navigator.bluetooth.requestDevice({
        filters: [{namePrefix: "Wearhack"}],
        optionalServices: [SERVICE_UUID]
      });
      state.device.addEventListener("gattserverdisconnected", handleDisconnect);
    }
    ui.name.textContent = "対象：" + (state.device.name || "選択済みの機器");
    const server = await state.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const command = await service.getCharacteristic(COMMAND_UUID);
    const notify = await service.getCharacteristic(NOTIFY_UUID);
    notify.addEventListener("characteristicvaluechanged", handleNotification);
    await notify.startNotifications();
    state.command = command;
    state.notify = notify;
    clearReadings();
    setConnection("接続済み", "online");
    showMessage("接続しました。本体状態を取得中です。");
    showControlMessage("状態が取得できるまで設定操作はできません。");
    state.interval = setInterval(() => {
      if (document.visibilityState === "visible" && !state.actionBusy) void refreshStatus();
    }, 5000);
    void refreshStatus();
  } catch (error) {
    if (state.device?.gatt?.connected) state.device.gatt.disconnect();
    const cancelled = error.name === "NotFoundError";
    setConnection("未接続", "offline");
    showMessage(cancelled ? "機器の選択がキャンセルされたか、検出されませんでした。" : "接続に失敗しました：" + error.message, !cancelled);
  } finally {
    state.connecting = false;
    updateButtons();
  }
}

loadDraft();
setSafetyUnlocked(false);
ui.safetyLock.addEventListener("click", () => {
  if (state.actionBusy || state.connecting) return;
  if (state.safetyUnlocked) {
    setSafetyUnlocked(false);
    showControlMessage("セーフティーロックしました。新たなコマンドは送信していません。");
    return;
  }
  if (!window.confirm(
    "実験用の設定範囲（25～60℃、1～150分）を解除します。\n" +
    "60℃・150分はメーカー公称上限を超え、安全性は未確認です。\n" +
    "本体の安全機能が解除されるわけではありません。続行しますか？"
  )) return;
  setSafetyUnlocked(true);
  showControlMessage("実験範囲を解除しました。高温・長時間運転は身体に装着せず短時間で確認してください。");
});
connectSettingsFields(ui.targetTemperature, ui.targetTemperatureRange);
connectSettingsFields(ui.targetDuration, ui.targetDurationRange);
ui.connect.addEventListener("click", () => { void connect(); });
ui.disconnect.addEventListener("click", () => {
  if (state.device?.gatt?.connected) state.device.gatt.disconnect();
});
ui.refresh.addEventListener("click", () => { void refreshStatus(); });
ui.powerOn.addEventListener("click", () => { void sendSettings("on"); });
ui.powerOff.addEventListener("click", () => { void sendSettings("off"); });
ui.apply.addEventListener("click", () => { void sendSettings("apply"); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && connected() && !state.actionBusy) void refreshStatus();
});
if (!window.isSecureContext || !navigator.bluetooth) {
  ui.connect.disabled = true;
  showMessage("Web Bluetooth非対応です。Android ChromeでHTTPSのページを開いてください。", true);
}
updateButtons();
