import {
  SERVICE_UUID, COMMAND_UUID, NOTIFY_UUID, STATUS_REQUEST,
  MIN_TEMPERATURE, MAX_TEMPERATURE, MIN_DURATION, MAX_DURATION,
  parseStatus, isSettingsAck, buildSettingsCommand, formatRemaining, formatHex
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
  lastCommand: $("last-command")
};
const storageKey = "wearhack2-web-control-settings-v1";
const state = {
  device: null, command: null, notify: null, interval: null,
  lastStatusAt: 0, lastStatus: null, connecting: false,
  actionBusy: false, pendingAck: null, pendingStatus: null
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
  // An empty number input must not silently become 0.
  if (ui.targetTemperature.value.trim() === "" || !Number.isInteger(temperature) ||
      temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE) {
    throw new RangeError("目標温度は35〜55℃の整数で入力してください");
  }
  if (ui.targetDuration.value.trim() === "" || !Number.isInteger(durationMinutes) ||
      durationMinutes < MIN_DURATION || durationMinutes > MAX_DURATION) {
    throw new RangeError("タイマーは1〜120分の整数で入力してください");
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
  ui.powerOn.disabled = !usable || !valid;
  ui.powerOff.disabled = !usable || !valid;
  ui.apply.disabled = !usable || !valid || !state.lastStatus.powerOn;
}

function storeDraft() {
  try { localStorage.setItem(storageKey, JSON.stringify(selectedSettings())); }
  catch { /* Browser storage may be disabled; controls remain usable. */ }
}
function loadDraft() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (Number.isInteger(data.temperature) && data.temperature >= 35 && data.temperature <= 55) {
      ui.targetTemperature.value = String(data.temperature);
    }
    if (Number.isInteger(data.durationMinutes) && data.durationMinutes >= 1 && data.durationMinutes <= 120) {
      ui.targetDuration.value = String(data.durationMinutes);
    }
  } catch { /* No saved settings. */ }
  ui.targetTemperatureRange.value = ui.targetTemperature.value;
  ui.targetDurationRange.value = ui.targetDuration.value;
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
  try {
    settings = selectedSettings();
  } catch (error) {
    showControlMessage(error.message, true);
    return;
  }
  if (!state.lastStatus) {
    showControlMessage("本体の状態を取得してから操作してください。", true);
    return;
  }
  if (mode === "apply" && !state.lastStatus.powerOn) return;

  state.actionBusy = true;
  updateButtons();
  showControlMessage("送信中です。ACKと本体状態を確認します。");
  try {
    if (state.pendingStatus) await state.pendingStatus.promise;
    if (!connected()) throw new Error("Bluetooth接続が切れました");
    if (Date.now() - state.lastStatusAt > 12000) await requestStatus();

    const desiredPower = mode === "apply" ? state.lastStatus.powerOn : mode === "on";
    const bytes = buildSettingsCommand({...settings, powerOn: desiredPower});
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
        showControlMessage("本体の電源" + powerLabel + "を確認しました。目標温度は本体から読み戻せないため、設定値の反映はACKに基づく判断です。");
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
