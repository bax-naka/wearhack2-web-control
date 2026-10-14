// Unofficial CIO WEARHACK2 protocol, observed on a test device 2026-10-14.
export const SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
export const COMMAND_UUID = "0000fff2-0000-1000-8000-00805f9b34fb";
export const NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";
export const STATUS_REQUEST = Uint8Array.from([0xaa, 0x01, 0x02, 0xfd]);

// Normal limits follow the original app UI and tested 120-minute timer.
// The wider values below are experimental and must be explicitly unlocked.
export const MIN_TEMPERATURE = 30;
export const MAX_TEMPERATURE = 55;
export const MIN_DURATION = 1;
export const MAX_DURATION = 120;
export const EXTENDED_MIN_TEMPERATURE = 25;
export const EXTENDED_MAX_TEMPERATURE = 60;
export const EXTENDED_MAX_DURATION = 150;

export function requiresExtendedRange({temperature, durationMinutes}) {
  return temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE ||
    durationMinutes > MAX_DURATION;
}

export function formatHex(value) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function hasValidChecksum(bytes) {
  return Array.from(bytes).slice(1).reduce((sum, byte) => sum + byte, 0) % 256 === 0;
}

function checkedByte(value) {
  return ((-value) & 0xff);
}

function isIntegerBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Commands observed with normal application and replayed using nRF Connect.
// Format: AA 06 01 HOURS MINUTES 00 TEMPERATURE POWER CHECK.
// The zero-valued reserved field must remain unchanged until its purpose is known.
export function buildSettingsCommand({temperature, durationMinutes, powerOn, allowExtended = false}) {
  if (typeof allowExtended !== "boolean") {
    throw new TypeError("拡張モードの指定が不正です");
  }
  const minTemp = allowExtended ? EXTENDED_MIN_TEMPERATURE : MIN_TEMPERATURE;
  const maxTemp = allowExtended ? EXTENDED_MAX_TEMPERATURE : MAX_TEMPERATURE;
  const maxDuration = allowExtended ? EXTENDED_MAX_DURATION : MAX_DURATION;
  if (!isIntegerBetween(temperature, minTemp, maxTemp)) {
    throw new RangeError(`目標温度は${minTemp}〜${maxTemp}℃の整数で指定してください`);
  }
  if (!isIntegerBetween(durationMinutes, MIN_DURATION, maxDuration)) {
    throw new RangeError(`タイマーは1〜${maxDuration}分の整数で指定してください`);
  }
  if (typeof powerOn !== "boolean") {
    throw new TypeError("電源状態はbooleanで指定してください");
  }
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const data = [0x06, 0x01, hours, minutes, 0x00, temperature, powerOn ? 0x01 : 0x00];
  const checksum = checkedByte(data.reduce((sum, byte) => sum + byte, 0));
  return Uint8Array.from([0xaa, ...data, checksum]);
}

function validateFrame(value) {
  const bytes = Uint8Array.from(value);
  if (bytes.length < 4 || bytes[0] !== 0xaa) {
    throw new Error("不正なフレーム開始コード");
  }
  if (bytes.length !== bytes[1] + 3 || !hasValidChecksum(bytes)) {
    throw new Error("フレーム長またはチェックサムの不一致");
  }
  return bytes;
}

export function isSettingsAck(value) {
  const bytes = validateFrame(value);
  return bytes.length === 4 && bytes[1] === 1 && bytes[2] === 1;
}

export function parseStatus(value) {
  const bytes = validateFrame(value);
  if (bytes[2] !== 0x02) {
    return null; // Normal settings ACK (AA 01 01 FE) or other command.
  }
  if (bytes.length !== 10 || bytes[1] !== 7) {
    throw new Error("未知の状態応答形式");
  }
  const [hours, minutes, seconds] = [bytes[3], bytes[4], bytes[5]];
  if (minutes > 59 || seconds > 59 || (bytes[7] !== 0 && bytes[7] !== 1)) {
    throw new Error("不正な残り時間または電源状態");
  }
  return {
    hours, minutes, seconds,
    temperature: bytes[6], // Measured temperature, NOT the target setpoint.
    powerOn: bytes[7] === 1,
    rawPower: bytes[7],
    unknown: bytes[8],
    raw: formatHex(bytes)
  };
}

export function formatRemaining({hours, minutes, seconds}) {
  const two = (n) => String(n).padStart(2, "0");
  return hours > 0 ? String(hours) + ":" + two(minutes) + ":" + two(seconds)
    : two(minutes) + ":" + two(seconds);
}
