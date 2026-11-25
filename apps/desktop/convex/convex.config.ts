import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import auth from '@convex-dev/auth/convex.config.js'
import authGithub from '@convex-dev/auth/components/github/convex.config.js'
import authGoogle from '@convex-dev/auth/components/google/convex.config.js'

const app = defineApp({ env: {
  AUTH_GITHUB_ID: v.string(), AUTH_GITHUB_SECRET: v.string(),
  AUTH_GOOGLE_ID: v.string(), AUTH_GOOGLE_SECRET: v.string(),
} })
app.use(auth)
// GitHub sign-in was removed. The component stays mounted, with no sign-in entry point, so the
// GitHub-ID-to-account links of existing accounts survive deploys and could be restored later.
app.use(authGithub, {
  httpPrefix: '/api/auth/callback/github',
  env: { CLIENT_ID: app.env.AUTH_GITHUB_ID, CLIENT_SECRET: app.env.AUTH_GITHUB_SECRET },
})
// Google's Authorized redirect URI must be this prefix plus /callback.
app.use(authGoogle, {
  httpPrefix: '/api/auth/callback/google',
  env: { CLIENT_ID: app.env.AUTH_GOOGLE_ID, CLIENT_SECRET: app.env.AUTH_GOOGLE_SECRET },
})
export default app
