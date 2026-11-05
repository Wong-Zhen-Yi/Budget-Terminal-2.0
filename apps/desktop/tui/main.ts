import { emitKeypressEvents } from 'node:readline'
import { startPortfolioTui } from './portfolio.js'

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run BT in an interactive terminal window.')
emitKeypressEvents(process.stdin)
startPortfolioTui()
