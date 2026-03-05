import { NextApiRequest, NextApiResponse } from 'next'
import { generateAccountingRecords } from '../../server/utils/accounting'

async function handle(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const records = await generateAccountingRecords()
    return res.status(200).json(records)
  } catch (err) {
    console.error('[accounting] Error generating accounting records:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    })
  }
}

export default handle
