export function log(level: 'info' | 'warn' | 'error', message: string) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [${level}] ${message}`)
}
