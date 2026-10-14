import {
  SERVICE_UUID, COMMAND_UUID, NOTIFY_UUID, STATUS_REQUEST,
  parseStatus, formatRemaining, formatHex
} from "./protocol.js";

const byId = (id) => document.getElementById(id);
const ui = {
  connect: byId("connect-button"),
  disconnect: byId("disconnect-button"),
  refresh: byId("refresh-button"),
  connection: byId("connection-state"),
  name: byId("device-name"),
  message: byId("connection-message"),
  temperature: byId("temperature"),
  remaining: byId("remaining"),
  power: byId("power"),
  updated: byId("updated-at"),
  lastPacket: byId("last-packet")
};

const state = {
  device: null,
  command: null,
  notify: null,
  interval: null,
  lastStatusAt: 0,
  connectionStartedAt: 0,
  connecting: false,
  writing: false
};

function showMessage(message, isError = false) {
  ui.message.textContent = message;
  ui.message.classList.toggle("error", isError);
}

function setConnection(label, className) {
  ui.connection.textContent = label;
  ui.connection.className = "state-pill " + className;
}

function clearReadings() {
  ui.temperature.textContent = "--";
  ui.remaining.textContent = "--:--";
  ui.power.textContent = "不明";
  ui.power.className = "reading-value power-value";
  ui.updated.textContent = "最終取得：未取得";
  ui.lastPacket.textContent = "未受信";
  state.lastStatusAt = 0;
}

function isConnected() {
  return Boolean(state.device && state.device.gatt && state.device.gatt.connected
    && state.command && state.notify);
}

function updateButtons() {
  ui.connect.disabled = state.connecting || isConnected();
  ui.connect.textContent = state.device ? "再接続" : "機器を選択して接続";
  ui.disconnect.disabled = !isConnected();
  ui.refresh.disabled = !isConnected();
}

function stopPolling() {
  if (state.interval !== null) clearInterval(state.interval);
  state.interval = null;
  state.writing = false;
}

function handleDisconnect() {
  stopPolling();
  state.command = null;
  state.notify = null;
  setConnection("未接続", "offline");
  clearReadings(); // Don't show stale ON/OFF as if it were current.
  showMessage("接続が切れました。「再接続」から接続し直してください。");
  updateButtons();
}

function handleNotification(event) {
  const view = event.target.value;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  ui.lastPacket.textContent = formatHex(bytes);
  try {
    const status = parseStatus(bytes);
    if (!status) return;
    state.lastStatusAt = Date.now();
    ui.temperature.textContent = String(status.temperature);
    ui.remaining.textContent = formatRemaining(status);
    ui.power.textContent = status.powerOn ? "ON" : "OFF";
    ui.power.className = "reading-value power-value " + (status.powerOn ? "on" : "off");
    ui.updated.textContent = "最終取得：" + new Date(state.lastStatusAt).toLocaleTimeString("ja-JP");
    showMessage("本体の状態を取得しました。");
  } catch (error) {
    showMessage("受信データを解釈できません：" + error.message, true);
  }
}

async function refreshStatus() {
  if (!isConnected() || state.writing) return;
  state.writing = true;
  try {
    await state.command.writeValueWithoutResponse(STATUS_REQUEST);
    if (!state.lastStatusAt && Date.now() - state.connectionStartedAt > 12000) {
      showMessage("状態取得を送信していますが、まだ本体から通知を受信できていません。", true);
    }
  } catch (error) {
    showMessage("状態取得コマンドの送信に失敗しました：" + error.message, true);
  } finally {
    state.writing = false;
  }
}

async function connect() {
  if (state.connecting || isConnected()) return;
  if (!window.isSecureContext || !navigator.bluetooth) {
    showMessage("Web Bluetooth を利用できません。Android Chrome と HTTPS のページから開いてください。", true);
    return;
  }
  state.connecting = true;
  setConnection("接続中", "connecting");
  showMessage("WEARHACK2への接続を開始します。");
  updateButtons();
  try {
    if (!state.device) {
      // requestDevice must be reached directly from a user-initiated click.
      state.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Wearhack" }],
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
    state.connectionStartedAt = Date.now();
    clearReadings();
    setConnection("接続済み", "online");
    showMessage("接続しました。状態取得を開始します。");
    state.interval = setInterval(() => {
      if (document.visibilityState === "visible") void refreshStatus();
    }, 5000);
    void refreshStatus();
  } catch (error) {
    if (state.device?.gatt?.connected) state.device.gatt.disconnect();
    const cancelled = error.name === "NotFoundError";
    setConnection("未接続", "offline");
    showMessage(cancelled ? "機器の選択がキャンセルされました。" : "接続に失敗しました：" + error.message, !cancelled);
  } finally {
    state.connecting = false;
    updateButtons();
  }
}

ui.connect.addEventListener("click", () => { void connect(); });
ui.disconnect.addEventListener("click", () => {
  if (state.device?.gatt?.connected) state.device.gatt.disconnect();
});
ui.refresh.addEventListener("click", () => { void refreshStatus(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isConnected()) void refreshStatus();
});

if (!window.isSecureContext || !navigator.bluetooth) {
  ui.connect.disabled = true;
  showMessage("Web Bluetooth 非対応の環境です。Android Chrome で HTTPS のページを開いてください。", true);
}
