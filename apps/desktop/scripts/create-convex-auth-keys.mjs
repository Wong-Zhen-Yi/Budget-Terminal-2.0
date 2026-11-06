import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Deliberately writes an ignored local file, never keys to stdout or shell arguments.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().replace(/\n/g, ' ')
const jwks = JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), use: 'sig' }] })
const target = resolve('.env.convex-auth.local')
writeFileSync(target, `JWT_PRIVATE_KEY="${pem}"\nJWKS='${jwks}'\n`, { flag: 'wx', mode: 0o600 })
console.log('Created ignored .env.convex-auth.local. Upload with convex env set --from-file, then remove this local file. Never commit or share it.')
