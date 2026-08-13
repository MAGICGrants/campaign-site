import 'dotenv/config'

import fs from 'fs'
import { getClosedSellOrders } from '../server/utils/kraken'

const startDate = new Date(process.argv[2] || '2025-01-14')
const outputFile = process.argv[3] || 'kraken-orders.json'

async function main() {
  console.log(`Fetching closed sell orders from ${startDate.toISOString()}...`)

  const orders = await getClosedSellOrders(startDate)

  fs.writeFileSync(outputFile, JSON.stringify(orders, null, 2))
  console.log(`Wrote ${orders.length} orders to ${outputFile}`)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
