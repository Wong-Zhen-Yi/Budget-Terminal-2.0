import { cronJobs, makeFunctionReference } from 'convex/server'
const crons = cronJobs()
crons.interval('Expire private sync history and authentication counters', { minutes: 10 }, makeFunctionReference<'mutation'>('sync:cleanupHistory'), {})
export default crons
