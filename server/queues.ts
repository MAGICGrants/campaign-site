import { Queue } from 'bullmq'
import { PerkPurchaseWorkerData } from './workers/perk'
import { redisConnection as connection } from '../config/redis'
import { env } from '../env.mjs'

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
    // 1 hour in production, 1 minute in development
    env.NODE_ENV === 'production' ? { every: 1000 * 60 * 60 } : { every: 1000 * 60 * 1 },
    { name: 'MembershipCheck', data: {} }
  )

  await accountingGenerationQueue.upsertJobScheduler(
    'AccountingGenerationScheduler',
    // 1 hour in production, 1 minute in development
    env.NODE_ENV === 'production' ? { every: 1000 * 60 * 60 } : { every: 1000 * 60 * 1 },
    { name: 'AccountingGeneration', data: {} }
  )

  console.log('[queues] BullMQ job schedulers registered (membership hourly, accounting every 2m)')
}
