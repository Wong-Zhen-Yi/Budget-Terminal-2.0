require('tsx/cjs')

const { app } = require('electron')

app.whenReady().then(async () => {
  try {
    const { getPoliticsPage } = require('../electron/services/politics.ts')
    const started = Date.now()
    const live = await getPoliticsPage(1, true)
    console.log(
      `live page 1: ${live.payload.trades.length} trade(s), raw ${live.payload.rawCount}, ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
    for (const trade of live.payload.trades.slice(0, 10)) {
      console.log(
        `${trade.transactionDate}  ${trade.politician}  ${trade.ticker}  ` +
          `${trade.tradeType}  ${trade.amount}`,
      )
    }
    if (!live.payload.trades.length) throw new Error('live Capitol Trades page returned no trades')
    const cached = await getPoliticsPage(1, false)
    if (!cached.payload.fromCache) throw new Error('second unforced load did not use the page cache')
    console.log(`cached reload: ${(cached.payload.cacheAgeSeconds ?? 0).toFixed(1)}s old`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
