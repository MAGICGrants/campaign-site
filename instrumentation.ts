import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    const { registerQueueSchedulers } = await import('./server/queues')
    try {
      await registerQueueSchedulers()
    } catch (err) {
      console.error('[queues] Failed to register BullMQ schedulers (is Redis up?)', err)
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
