import { test } from "node:test";
import assert from "node:assert/strict";
import { isIpAllowed, normalizeCidr, normalizeIp } from "./ip";

test("exact IPv4 match", () => {
  assert.equal(isIpAllowed("203.0.113.7", ["203.0.113.7"]), true);
  assert.equal(isIpAllowed("203.0.113.8", ["203.0.113.7"]), false);
});

test("IPv4 CIDR range", () => {
  assert.equal(isIpAllowed("203.0.113.200", ["203.0.113.0/24"]), true);
  assert.equal(isIpAllowed("203.0.114.1", ["203.0.113.0/24"]), false);
});

test("IPv6 prefix (phones on building Wi-Fi may use IPv6)", () => {
  assert.equal(isIpAllowed("2401:4900:1c2a:5e10::abcd", ["2401:4900:1c2a:5e10::/64"]), true);
  assert.equal(isIpAllowed("2401:4900:1c2a:5e11::abcd", ["2401:4900:1c2a:5e10::/64"]), false);
});

test("IPv4-mapped IPv6 client address matches an IPv4 entry", () => {
  assert.equal(isIpAllowed("::ffff:203.0.113.7", ["203.0.113.7"]), true);
});

test("garbage never matches", () => {
  assert.equal(isIpAllowed("not-an-ip", ["0.0.0.0/0"]), false);
  assert.equal(isIpAllowed("203.0.113.7", ["nonsense"]), false);
  assert.equal(isIpAllowed("203.0.113.7", []), false);
});

test("normalisation", () => {
  assert.equal(normalizeCidr(" 203.0.113.7 "), "203.0.113.7");
  assert.equal(normalizeCidr("203.0.113.9/24"), "203.0.113.0/24");
  assert.equal(normalizeCidr("2401:4900:1c2a:5e10:1::/64"), "2401:4900:1c2a:5e10::/64");
  assert.equal(normalizeCidr("1.2.3"), null);
  assert.equal(normalizeCidr("1.2.3/24"), null);
  assert.equal(isIpAllowed("1.2.3", ["1.2.0.3"]), false);
  assert.equal(normalizeIp("::ffff:10.0.0.1"), "10.0.0.1");
});
