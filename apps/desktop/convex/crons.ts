import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
crons.interval('Remove expired OAuth requests and action grants', { minutes: 5 }, internal.authMaintenance.cleanup)
export default crons
