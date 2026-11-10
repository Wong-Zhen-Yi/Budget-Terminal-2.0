import assert from 'node:assert/strict'
import { cloudBuildUrl, CloudBackendUpgradeError, requireCloudBackend } from '../electron/shared/cloudSyncConfiguration.js'

const config = { productionUrl: '', developmentUrl: '' }
const localUrl = 'https://fixture-dev.convex.cloud'
const productionUrl = 'https://fixture-prod.convex.cloud'
const development = { VITE_CONVEX_URL: localUrl }
assert.equal(cloudBuildUrl('serve', development, config), localUrl)
assert.equal(cloudBuildUrl('build', { ...development, BUDGET_TERMINAL_LOCAL_BUILD: '1' }, config), localUrl,
  'Double-click local installs must retain access to the existing saved-data backend')
assert.equal(cloudBuildUrl('build', development, config), '', 'Ordinary production bundles must never inherit a development endpoint')
assert.throws(() => cloudBuildUrl('build', { ...development, BUDGET_TERMINAL_RELEASE: '1', BUDGET_TERMINAL_LOCAL_BUILD: '1' }, config))
assert.equal(cloudBuildUrl('build', { ...development, BUDGET_TERMINAL_RELEASE: '1', BUDGET_TERMINAL_LOCAL_BUILD: '1', BUDGET_TERMINAL_SYNC_PRODUCTION_URL: productionUrl }, config), productionUrl)
assert.equal(cloudBuildUrl('build', { BUDGET_TERMINAL_LOCAL_BUILD: '1', BUDGET_TERMINAL_SYNC_DEVELOPMENT_URL: localUrl }, config), localUrl)
assert.equal(cloudBuildUrl('build', { BUDGET_TERMINAL_RELEASE: '1' }, { ...config, productionUrl }), productionUrl)
assert.throws(() => requireCloudBackend({ protocol: 1, githubConfigured: true, emailConfigured: false }), CloudBackendUpgradeError,
  'An old backend must be detected before sending the user through browser approval')
assert.equal(requireCloudBackend({ protocol: 2, githubConfigured: true, emailConfigured: false }).emailConfigured, false)
console.log('PASS: local launcher backend selection, production/development separation, release guard and pre-sign-in backend compatibility')
