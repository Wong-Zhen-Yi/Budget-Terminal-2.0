import type { LookupAddress, LookupAllOptions } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { LookupFunction } from 'node:net'

const blockedV4 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blockedV4.addSubnet(address, prefix, 'ipv4')

// Only global unicast IPv6 can be a publisher. Reject transition mechanisms,
// mapped IPv4, local networks, and IANA special-purpose/documentation ranges.
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const blockedV6 = new BlockList()
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blockedV6.addSubnet(address, prefix, 'ipv6')

export function isPublicAddress(address: string): boolean {
  if (address.includes('%')) return false
  const family = isIP(address)
  if (family === 4) return !blockedV4.check(address, 'ipv4')
  return family === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6')
}

export function publicNewsUrl(value: string): URL {
  const target = new URL(value)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('News links must be HTTP(S) URLs without credentials.')
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  // Node skips lookup for IP literals. WHATWG URL parsing normalizes alternate
  // numeric IPv4 representations before this check.
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new Error('News links must use public network addresses.')
  }
  return target
}

type ResolveAddresses = (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>

export function createPublicLookup(resolveAddresses: ResolveAddresses = lookup): LookupFunction {
  return (hostname, options, callback) => {
    // Validate exactly the answers used by the socket, with no second lookup.
    // Check both families even if the caller would otherwise request only one.
    void resolveAddresses(hostname, { ...options, family: 0, all: true }).then(addresses => {
      if (!addresses.length || addresses.some(result => !isPublicAddress(result.address) || isIP(result.address) !== result.family)) {
        const error: NodeJS.ErrnoException = new Error('News links must resolve only to public network addresses.')
        error.code = 'EACCES'
        callback(error, [])
        return
      }
      const selected = addresses.filter(result => !options.family || options.family === result.family ||
        options.family === (result.family === 4 ? 'IPv4' : 'IPv6'))
      if (!selected.length) {
        callback(new Error('No public address for the requested network family.'), [])
        return
      }
      if (options.all) callback(null, selected)
      else callback(null, selected[0]!.address, selected[0]!.family)
    }, error => callback(error as NodeJS.ErrnoException, []))
  }
}
