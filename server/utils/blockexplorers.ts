type MempoolTxResponse = {
  fee: number
}

type XmrTxResponse = {
  data: {
    tx_fee: number
  }
}

const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000

async function fetchWithRetry(url: string, label: string): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url)

      if (!response.ok) {
        if (attempt < MAX_RETRIES) {
          const backoff = RETRY_BASE_MS * Math.pow(2, attempt)
          console.log(
            `[accounting] ${label}: HTTP ${response.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
          )
          await new Promise((resolve) => setTimeout(resolve, backoff))
          continue
        }
        throw new Error(`${label}: HTTP ${response.status}`)
      }

      return response
    } catch (err) {
      lastError = err

      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt)
        console.log(
          `[accounting] ${label}: ${err instanceof Error ? err.message : 'request failed'}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        )
        await new Promise((resolve) => setTimeout(resolve, backoff))
        continue
      }
    }
  }

  throw lastError ?? new Error(`${label}: max retries exceeded`)
}

export async function getNetworkFee(txid: string, cryptoCode: string): Promise<number> {
  switch (cryptoCode) {
    case 'BTC':
      return getBtcNetworkFee(txid)
    case 'LTC':
      return getLtcNetworkFee(txid)
    case 'XMR':
      return getXmrNetworkFee(txid)
    case 'USDC':
      return 0
    default:
      throw new Error(`Unsupported crypto code for network fee lookup: ${cryptoCode}`)
  }
}

async function getBtcNetworkFee(txid: string): Promise<number> {
  const response = await fetchWithRetry(
    `https://mempool.space/api/tx/${txid}`,
    `mempool.space tx ${txid.slice(0, 8)}...`
  )
  const data = (await response.json()) as MempoolTxResponse
  return data.fee / 100_000_000
}

async function getLtcNetworkFee(txid: string): Promise<number> {
  const response = await fetchWithRetry(
    `https://litecoinspace.org/api/tx/${txid}`,
    `litecoinspace.org tx ${txid.slice(0, 8)}...`
  )
  const data = (await response.json()) as MempoolTxResponse
  return data.fee / 100_000_000
}

async function getXmrNetworkFee(txid: string): Promise<number> {
  const response = await fetchWithRetry(
    `https://hashvault.pro/monero/explorer/api/transaction/${txid}`,
    `XMR explorer tx ${txid.slice(0, 8)}...`
  )
  const data = (await response.json()) as XmrTxResponse
  return data.data.tx_fee / 1_000_000_000_000
}
