import { Worker } from 'bullmq'
import { redisConnection as connection } from '../../config/redis'
import { generateAccountingRecords } from '../utils/accounting'

const globalForWorker = global as unknown as { hasInitializedAccountingWorker: boolean }

if (!globalForWorker.hasInitializedAccountingWorker) {
  new Worker(
    'AccountingGeneration',
    async () => {
      try {
        const records = await generateAccountingRecords()
        return { count: records.length }
      } catch (err) {
        console.error('[accounting] Error generating accounting records:', err)
        throw err
      }
    },
    { connection }
  )
  globalForWorker.hasInitializedAccountingWorker = true
}
