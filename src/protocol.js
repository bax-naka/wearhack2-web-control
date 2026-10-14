// Observed on CIO WEARHACK2 (2026-10-14). Not an official protocol specification.
export const SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
export const COMMAND_UUID = "0000fff2-0000-1000-8000-00805f9b34fb";
export const NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";

export const STATUS_REQUEST = Uint8Array.from([0xaa, 0x01, 0x02, 0xfd]);

export function formatHex(value) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function hasValidChecksum(bytes) {
  // The byte sum from LEN to CHECK (excluding AA) must be 0 modulo 256.
  return bytes.slice(1).reduce((sum, byte) => sum + byte, 0) % 256 === 0;
}

export function parseStatus(value) {
  const bytes = Uint8Array.from(value);
  if (bytes.length < 4 || bytes[0] !== 0xaa) {
    throw new Error("不正なフレーム開始コード");
  }
  if (bytes.length !== bytes[1] + 3 || !hasValidChecksum(bytes)) {
    throw new Error("フレーム長またはチェックサムの不一致");
  }
  if (bytes[2] !== 0x02) {
    // ACK (AA 01 01 FE) and other frames aren't status reports.
    return null;
  }
  if (bytes.length !== 10 || bytes[1] !== 7) {
    throw new Error("未知の状態応答形式");
  }
  const [hours, minutes, seconds] = [bytes[3], bytes[4], bytes[5]];
  if (minutes > 59 || seconds > 59) {
    throw new Error("残り時間が不正");
  }
  return {
    hours,
    minutes,
    seconds,
    temperature: bytes[6], // Measured temperature, NOT target setpoint.
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
