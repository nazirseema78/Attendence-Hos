import ipaddr from "ipaddr.js";

type Range = [ipaddr.IPv4 | ipaddr.IPv6, number];

/**
 * Parse one address. Rejects legacy IPv4 shorthands like "1.2.3" (which ipaddr.js would read
 * as 1.2.0.3) so a typo can't silently allow the wrong network. IPv4-mapped IPv6 becomes IPv4.
 */
function parseAddress(value: string): ipaddr.IPv4 | ipaddr.IPv6 {
  if (!value.includes(":") && !ipaddr.IPv4.isValidFourPartDecimal(value)) {
    throw new Error("Invalid IPv4 address");
  }
  return ipaddr.process(value);
}

/** Parse "1.2.3.4", "1.2.3.0/24" or "2401:db00::/48". IPv4-mapped IPv6 is unwrapped to IPv4. */
function parseRange(entry: string): Range | null {
  const value = entry.trim();
  try {
    if (value.includes("/")) {
      parseAddress(value.slice(0, value.indexOf("/")));
      const [addr, bits] = ipaddr.parseCIDR(value);
      if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress() && bits >= 96) {
        return [(addr as ipaddr.IPv6).toIPv4Address(), bits - 96];
      }
      return [addr, bits];
    }
    const addr = parseAddress(value);
    return [addr, addr.kind() === "ipv4" ? 32 : 128];
  } catch {
    return null;
  }
}

/** Canonical form of an allowlist entry, or null if invalid. */
export function normalizeCidr(entry: string): string | null {
  const range = parseRange(entry);
  if (!range) return null;
  const [addr, bits] = range;
  const full = addr.kind() === "ipv4" ? 32 : 128;
  return bits === full ? addr.toString() : `${networkAddress(range)}/${bits}`;
}

function networkAddress([addr, bits]: Range): string {
  if (addr.kind() === "ipv4") return ipaddr.IPv4.networkAddressFromCIDR(`${addr}/${bits}`).toString();
  return ipaddr.IPv6.networkAddressFromCIDR(`${addr}/${bits}`).toString();
}

/** Canonical form of a single client IP, or null if invalid. */
export function normalizeIp(ip: string): string | null {
  try {
    return parseAddress(ip.trim()).toString();
  } catch {
    return null;
  }
}

export function isIpAllowed(ip: string, allowlist: string[]): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = parseAddress(ip.trim());
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    const range = parseRange(entry);
    return range !== null && range[0].kind() === addr.kind() && addr.match(range);
  });
}
