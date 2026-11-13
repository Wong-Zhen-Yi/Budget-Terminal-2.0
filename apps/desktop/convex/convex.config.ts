import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import auth from '@convex-dev/auth/convex.config.js'
import authGithub from '@convex-dev/auth/components/github/convex.config.js'

const app = defineApp({ env: { AUTH_GITHUB_ID: v.string(), AUTH_GITHUB_SECRET: v.string() } })
app.use(auth)
// GitHub's exact redirect registration must include this prefix plus /callback.
app.use(authGithub, {
  httpPrefix: '/api/auth/callback/github',
  env: { CLIENT_ID: app.env.AUTH_GITHUB_ID, CLIENT_SECRET: app.env.AUTH_GITHUB_SECRET },
})
export default app
