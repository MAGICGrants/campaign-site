import { Worker } from 'bullmq'
import { redisConnection as connection } from '../../config/redis'
import { prisma } from '../services'
import { DonationCryptoPayments } from '../types'
import { log } from '../../utils/logging'

const globalForWorker = global as unknown as { hasInitializedWorkers: boolean }

if (!globalForWorker.hasInitializedWorkers)
  new Worker(
    'DonationMigration',
    async (job) => {
      // Finds unmigrated donations and updates them

      const donations = await prisma.donation.findMany({
        where: { btcPayInvoiceId: { not: null }, cryptoPayments: { equals: undefined } },
      })

      await Promise.all(
        donations.map(async (donation) => {
          const cryptoPayments: DonationCryptoPayments = [
            {
              cryptoCode: donation.cryptoCode as DonationCryptoPayments[0]['cryptoCode'],
              grossAmount: Number(donation.grossCryptoAmount!),
              netAmount: Number(donation.netCryptoAmount),
              rate: donation.grossFiatAmount / Number(donation.grossCryptoAmount),
            },
          ]

          await prisma.donation.update({
            where: { id: donation.id },
            data: { cryptoPayments, grossCryptoAmount: null, netCryptoAmount: null },
          })
        })
      )

      log('info', `[Donation migration] Successfully updated ${donations.length} records!!!!!!!!!!`)
    },
    { connection }
  )

if (process.env.NODE_ENV !== 'production') globalForWorker.hasInitializedWorkers = true
