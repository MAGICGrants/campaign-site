export function formatUsd(dollars: number): string {
  if (dollars == 0) {
    return '$0'
  } else if (dollars / 1000 > 1) {
    return `$${Math.round(dollars / 1000)}k+`
  } else {
    return `$${dollars.toFixed(0)}`
  }
}

export function formatBtc(bitcoin: number) {
  if (bitcoin > 0.1) {
    return `${bitcoin.toFixed(3) || 0.0} BTC`
  } else {
    return `${Math.floor(bitcoin * 100000000).toLocaleString()} sats`
  }
}
