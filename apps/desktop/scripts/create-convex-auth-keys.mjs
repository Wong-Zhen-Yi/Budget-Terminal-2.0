import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Writes an ignored dotenv file; key bytes never enter stdout or shell arguments.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().split(String.fromCharCode(10)).join(' ')
const jwks = JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256' }] })
const target = resolve('.env.convex-auth.local')
const lines = [`JWT_PRIVATE_KEY="${pem}"`, `JWKS='${jwks}'`, '']
writeFileSync(target, lines.join(String.fromCharCode(10)), { flag: 'wx', mode: 0o600 })
console.log('Created ignored .env.convex-auth.local. Upload with convex env set --from-file, then remove this local file. Never commit or share it.')
