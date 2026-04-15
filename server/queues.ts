import { Queue } from 'bullmq'
import { PerkPurchaseWorkerData } from './workers/perk'
import { redisConnection as connection } from '../config/redis'

import './workers/perk'
import './workers/membership-check'
import './workers/accounting'

export const perkPurchaseQueue = new Queue<PerkPurchaseWorkerData>('PerkPurchase', { connection })

export const membershipCheckQueue = new Queue('MembershipCheck', { connection })

export const accountingGenerationQueue = new Queue('AccountingGeneration', { connection })

/**
 * Must be awaited on server boot (see instrumentation.ts). `upsertJobScheduler` is async;
 * firing it without await can leave schedulers unregistered if Redis is slow or the process exits early.
 */
export async function registerQueueSchedulers(): Promise<void> {
  await membershipCheckQueue.upsertJobScheduler(
    'MembershipCheckScheduler',
    { pattern: '0 0 * * * *' },
    { name: 'MembershipCheck', data: {} }
  )

  await accountingGenerationQueue.upsertJobScheduler(
    'AccountingGenerationScheduler',
    // 6-field cron (sec min …): every 2 minutes at second 0
    { pattern: '0 * * * *' },
    { name: 'AccountingGeneration', data: {} }
  )

  console.log('[queues] BullMQ job schedulers registered (membership hourly, accounting every 2m)')
}
