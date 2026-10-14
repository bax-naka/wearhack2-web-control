import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_REQUEST, parseStatus, hasValidChecksum, formatRemaining, formatHex,
  buildSettingsCommand, isSettingsAck
} from "../src/protocol.js";

const bytes = (hex) => Uint8Array.from(hex.split(" "), (chunk) => parseInt(chunk, 16));

test("status request matches observed command", () => {
  assert.equal(formatHex(STATUS_REQUEST), "AA 01 02 FD");
  assert.equal(hasValidChecksum(STATUS_REQUEST), true);
});

test("parse powered-on status", () => {
  const status = parseStatus(bytes("AA 07 02 00 0E 33 2C 01 00 89"));
  assert.equal(status.powerOn, true);
  assert.equal(status.temperature, 44);
  assert.equal(formatRemaining(status), "14:51");
});

test("parse powered-off status", () => {
  const status = parseStatus(bytes("AA 07 02 00 00 00 1B 00 00 DC"));
  assert.equal(status.powerOn, false);
  assert.equal(status.temperature, 27);
  assert.equal(formatRemaining(status), "00:00");
});

test("parse 30-minute countdown", () => {
  const status = parseStatus(bytes("AA 07 02 00 1D 24 27 01 00 8E"));
  assert.equal(formatRemaining(status), "29:36");
});

test("represent longer than 60-minute time", () => {
  assert.equal(formatRemaining({hours: 1, minutes: 29, seconds: 59}), "1:29:59");
});

test("match measured ACK, not status", () => {
  assert.equal(isSettingsAck(bytes("AA 01 01 FE")), true);
  assert.equal(isSettingsAck(bytes("AA 07 02 00 0E 33 2C 01 00 89")), false);
  assert.equal(parseStatus(bytes("AA 01 01 FE")), null);
});

test("reject invalid frames", () => {
  assert.throws(() => parseStatus(bytes("AA 07 02 00 0E 33 2C 01 00 88")), /チェックサム/);
  assert.throws(() => parseStatus(bytes("AA 07 02 00 0E 33 2C 01 89")), /フレーム長/);
  assert.throws(() => isSettingsAck(bytes("AA 01 01 00")), /チェックサム/);
});

test("35°C / 15min / ON agrees with captured packet", () => {
  assert.equal(formatHex(buildSettingsCommand({
    temperature: 35, durationMinutes: 15, powerOn: true
  })), "AA 06 01 00 0F 00 23 01 C6");
});

test("45°C / 15min / ON agrees with captured packet", () => {
  assert.equal(formatHex(buildSettingsCommand({
    temperature: 45, durationMinutes: 15, powerOn: true
  })), "AA 06 01 00 0F 00 2D 01 BC");
});

test("40°C / 30min / ON agrees with captured packet", () => {
  assert.equal(formatHex(buildSettingsCommand({
    temperature: 40, durationMinutes: 30, powerOn: true
  })), "AA 06 01 00 1E 00 28 01 B2");
});

test("40°C / 60min / ON agrees with captured packet", () => {
  assert.equal(formatHex(buildSettingsCommand({
    temperature: 40, durationMinutes: 60, powerOn: true
  })), "AA 06 01 01 00 00 28 01 CF");
});

test("30°C / 15min / OFF agrees with an earlier frame only as an observed historical input", () => {
  // Although observed earlier, 30°C is outside the product's supported range.
  assert.throws(() => buildSettingsCommand({
    temperature: 30, durationMinutes: 15, powerOn: false
  }), /目標温度/);
});

test("40°C / 120min / OFF has a valid checksum", () => {
  const frame = buildSettingsCommand({temperature: 40, durationMinutes: 120, powerOn: false});
  assert.equal(frame[3], 2);
  assert.equal(frame[4], 0);
  assert.equal(hasValidChecksum(frame), true);
});

test("reject unsafe or malformed setting values", () => {
  for (const invalid of [34, 56, 40.5, NaN, "40"]) {
    assert.throws(() => buildSettingsCommand({
      temperature: invalid, durationMinutes: 15, powerOn: true
    }));
  }
  for (const invalid of [0, 121, 1.5, Infinity, "15"]) {
    assert.throws(() => buildSettingsCommand({
      temperature: 40, durationMinutes: invalid, powerOn: true
    }));
  }
  assert.throws(() => buildSettingsCommand({
    temperature: 40, durationMinutes: 15, powerOn: 1
  }), /電源状態/);
});
