import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhone, normalizePhone } from "./phone";

test("Pakistani mobile formats normalise to +92", () => {
  for (const input of ["03001234567", "0300 1234567", "0300-1234567", "300 1234567", "92 300 1234567", "+92 300 1234567", "0092 300 1234567"]) {
    assert.equal(normalizePhone(input), "+923001234567", input);
  }
});

test("Pakistani landline with area code", () => {
  assert.equal(normalizePhone("042 3576 1234"), "+924235761234");
});

test("other international numbers are kept", () => {
  assert.equal(normalizePhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalizePhone("+44 7700 900123"), "+447700900123");
});

test("invalid numbers are rejected", () => {
  for (const input of ["12345", "0300123", "abc", "", "+0123", "+92 12", "1234567890123456"]) {
    assert.equal(normalizePhone(input), null, input);
  }
});

test("display format", () => {
  assert.equal(formatPhone("+923001234567"), "+92 300 1234567");
  assert.equal(formatPhone("+447700900123"), "+447700900123");
});
