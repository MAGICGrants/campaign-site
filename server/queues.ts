import { Queue } from 'bullmq'
import { PerkPurchaseWorkerData } from './workers/perk'
import { redisConnection as connection } from '../config/redis'

import './workers/perk'
import './workers/membership-check'
import './workers/accounting'

export const perkPurchaseQueue = new Queue<PerkPurchaseWorkerData>('PerkPurchase', { connection })

export const membershipCheckQueue = new Queue('MembershipCheck', { connection })

export const accountingGenerationQueue = new Queue('AccountingGeneration', { connection })

membershipCheckQueue.upsertJobScheduler(
  'MembershipCheckScheduler',
  { pattern: '0 * * * *' },
  { name: 'MembershipCheck' }
)

accountingGenerationQueue.upsertJobScheduler(
  'AccountingGenerationScheduler',
  { pattern: '0 * * * *' },
  { name: 'AccountingGeneration' }
)
