import 'dotenv/config'

import fs from 'fs'
import { getDeposits } from '../server/utils/kraken'

const startDate = new Date(process.argv[2] || '2025-01-14')
const outputFile = process.argv[3] || 'kraken-deposits.json'

async function main() {
  console.log(`Fetching deposits from ${startDate.toISOString()}...`)

  const deposits = await getDeposits(startDate)

  fs.writeFileSync(outputFile, JSON.stringify(deposits.reverse(), null, 2))
  console.log(`Wrote ${deposits.length} deposits to ${outputFile}`)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
