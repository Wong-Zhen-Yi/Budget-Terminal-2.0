import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDesktopCertificateSecurity } from '../electron/shared/certificateSecurity.js'

const require = createRequire(import.meta.url)
const { supportedNodeVersion } = require('../../../scripts/runtime.cjs')
for (const version of ['44.9.3', '44.10.0', '45.0.0']) {
  assertDesktopCertificateSecurity(version, {}, () => false)
}
for (const version of [undefined, 'invalid', '43.8.3', '44.9.2', '44.9.3-beta.1']) {
  assert.throws(() => assertDesktopCertificateSecurity(version, {}, () => false), /Electron 44.9.3/)
}
for (const key of ['NODE_TLS_REJECT_UNAUTHORIZED', 'node_tls_reject_unauthorized']) {
  assert.throws(() => assertDesktopCertificateSecurity('44.9.3', { [key]: '0' }, () => false), /verification/)
}
for (const flag of ['ignore-certificate-errors', 'ignore-certificate-errors-spki-list', 'allow-insecure-localhost']) {
  assert.throws(() => assertDesktopCertificateSecurity('44.9.3', {}, name => name === flag), /bypasses/)
}
assertDesktopCertificateSecurity('44.9.3', { NODE_TLS_REJECT_UNAUTHORIZED: '1' }, () => false)
console.log('PASS: patched Electron floor and TLS bypass rejection')

if (process.argv.includes('--live')) {
  assert(supportedNodeVersion(process.versions.node), 'Live system TLS checks require a patched Node installation')
  const hosts = ['dv', 'ov', 'ev'].flatMap(kind => ['g3b', 'g3c'].flatMap(branch =>
    [`${kind}-${branch}-emudhra.we-have-a-problem.com`, `${kind}-${branch}-aaa-emudhra.we-have-a-problem.com`]))
  // Fresh sockets: no credentials, application requests, or TLS-session resumption.
  const nodeChecks = `
    const tls = require('node:tls')
    async function checkNode() {
      await Promise.all(${JSON.stringify(hosts)}.map(host => new Promise((resolve, reject) => {
        const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true })
        socket.setTimeout(12000, () => socket.destroy(new Error('TLS probe timeout: ' + host)))
        socket.once('secureConnect', () => { socket.destroy(); reject(new Error('Compromised chain accepted: ' + host)) })
        socket.once('error', error => error.code === 'CERT_REVOKED' ? resolve() : reject(new Error(host + ': ' + error.code + ' ' + error.message)))
      })))
    }
  `
  const scratch = await mkdtemp(join(tmpdir(), 'budget-certificates-'))
  const run = async (binary: string, source: string, name: string) => {
    const file = join(scratch, `${name}.cjs`)
    await writeFile(file, source)
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: scratch, LOCALAPPDATA: scratch }
      delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(binary, [file], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${name} timed out: ${output}`)) }, 45_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); resolve({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
    console.log(result.output.split(/\r?\n/).filter(line => line.startsWith('PASS:')).join('\n'))
  }
  try {
    await run(process.execPath, `${nodeChecks}\ncheckNode().then(() => console.log('PASS: system Node rejects all 12 compromised chains'), error => { console.error(error); process.exitCode = 1 })`, 'node')
    await run(require('electron'), `
      const { app, session } = require('electron')
      const { Worker } = require('node:worker_threads')
      app.setPath('userData', ${JSON.stringify(join(scratch, 'profile'))})
      ${nodeChecks}
      app.whenReady().then(async () => {
        try {
          await checkNode()
          console.log('PASS: Electron Node rejects all 12 compromised chains')
          await new Promise((resolve, reject) => {
            const worker = new Worker(${JSON.stringify(`${nodeChecks}\ncheckNode().catch(error => { console.error(error); process.exitCode = 1 })`)}, { eval: true })
            worker.once('error', reject)
            worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Worker TLS checks failed')))
          })
          console.log('PASS: Electron worker rejects all 12 compromised chains')
          const healthy = await session.defaultSession.fetch('https://example.com/', { signal: AbortSignal.timeout(12000) })
          if (!healthy.ok) throw new Error('Healthy Chromium HTTPS control failed: ' + healthy.status)
          await healthy.text()
          const errors = await Promise.all(${JSON.stringify(hosts)}.map(async host => {
            try { await session.defaultSession.fetch('https://' + host + '/', { signal: AbortSignal.timeout(12000) }) }
            catch (error) {
              const code = String(error).match(/net::(ERR_CERT_[A-Z_]+)/)?.[1]
              if (code === 'ERR_CERT_REVOKED' || code === 'ERR_CERT_AUTHORITY_INVALID') return code
              throw new Error(host + ': ' + error)
            }
            throw new Error('Chromium accepted a compromised chain: ' + host)
          }))
          console.log('PASS: Chromium accepts healthy HTTPS and rejects all 12 compromised chains (' + [...new Set(errors)].join(', ') + ')')
          app.exit(0)
        } catch (error) { console.error(error); app.exit(1) }
      })
    `, 'electron')
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
