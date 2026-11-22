import { createServer, type Socket } from 'node:net'
import type { MobileTailnet } from './mobileTailscale.js'
import { MOBILE_DIRECT_LOCAL_PORT } from '../shared/mobileAccess.js'

/** This listener is only for tailscaled's loopback TCP forwarder. */
export async function startMobileDirect(
  getRoute: () => MobileTailnet['direct'],
  handoff: (socket: Socket, address: string) => void,
  port = MOBILE_DIRECT_LOCAL_PORT,
) {
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
    socket.setTimeout(3000, close)
    let input: Buffer<ArrayBufferLike> | undefined
    function close() { socket.destroy() }
    function read(chunk: Buffer) {
      if (input) chunk = Buffer.concat([input, chunk])
      const end = chunk.indexOf('\r\n')
      if (end < 0 && chunk.length <= 107) { input = chunk; return }
      if (end < 0 || end > 105) return close()
      const header = /^PROXY TCP4 ([\d.]+) ([\d.]+) ([1-9]\d{0,4}) (\d+)$/.exec(chunk.toString('latin1', 0, end))
      const route = getRoute()
      if (!header || !route || header[2] !== route.address || !route.owners.has(header[1]) ||
          Number(header[3]) > 65535 || Number(header[4]) !== MOBILE_DIRECT_LOCAL_PORT) return close()
      socket.pause()
      socket.off('data', read)
      socket.off('timeout', close)
      socket.setTimeout(0)
      socket.unshift(chunk.subarray(end + 2))
      handoff(socket, header[1])
      socket.resume()
    }
    socket.on('data', read)
  })
  server.maxConnections = 128
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return {
    port: (server.address() as { port: number }).port,
    close: async () => {
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      for (const socket of sockets) socket.destroy()
      await closed
    },
  }
}
