import test from "node:test";
import assert from "node:assert/strict";
import { STATUS_REQUEST, parseStatus, hasValidChecksum, formatRemaining, formatHex } from "../src/protocol.js";

const bytes = (hex) => Uint8Array.from(hex.split(" "), (chunk) => parseInt(chunk, 16));

test("request matches measured status command", () => {
  assert.equal(formatHex(STATUS_REQUEST), "AA 01 02 FD");
  assert.equal(hasValidChecksum(STATUS_REQUEST), true);
});

test("parse powered-on status from actual captured bytes", () => {
  const status = parseStatus(bytes("AA 07 02 00 0E 33 2C 01 00 89"));
  assert.equal(status.powerOn, true);
  assert.equal(status.temperature, 44);
  assert.equal(formatRemaining(status), "14:51");
});

test("parse powered-off status from actual captured bytes", () => {
  const status = parseStatus(bytes("AA 07 02 00 00 00 1B 00 00 DC"));
  assert.equal(status.powerOn, false);
  assert.equal(status.temperature, 27);
  assert.equal(formatRemaining(status), "00:00");
});

test("parse 30-minute countdown from actual captured bytes", () => {
  const status = parseStatus(bytes("AA 07 02 00 1D 24 27 01 00 8E"));
  assert.equal(formatRemaining(status), "29:36");
});

test("represent more than 60 minutes", () => {
  assert.equal(formatRemaining({hours: 1, minutes: 29, seconds: 59}), "1:29:59");
});

test("ignore valid ACK packets", () => {
  assert.equal(parseStatus(bytes("AA 01 01 FE")), null);
});

test("reject corrupt checksum or packet length", () => {
  assert.throws(() => parseStatus(bytes("AA 07 02 00 0E 33 2C 01 00 88")), /チェックサム/);
  assert.throws(() => parseStatus(bytes("AA 07 02 00 0E 33 2C 01 89")), /フレーム長/);
});
