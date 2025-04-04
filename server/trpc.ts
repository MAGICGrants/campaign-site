import { TRPCError, initTRPC } from '@trpc/server'
import { CreateNextContextOptions } from '@trpc/server/adapters/next'
import { getServerSession } from 'next-auth/next'
import superjson from 'superjson'
import util from 'util'
import { authOptions } from '../pages/api/auth/[...nextauth]'

export const createContext = async (opts: CreateNextContextOptions) => {
  const session = await getServerSession(opts.req, opts.res, authOptions)
  return { session }
}

// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<typeof createContext>().create({
  /**
   * @link https://trpc.io/docs/v11/data-transformers
   */
  transformer: superjson,
  errorFormatter: ({ error, shape }) => {
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      console.error(error)

      return {
        message: 'Internal server error',
        code: shape.code,
        data: {
          code: shape.data.code,
          httpStatus: shape.data.httpStatus,
          path: shape.data.path,
        },
      }
    }

    return shape
  },
})

// Base router and procedure helpers
export const router = t.router

export const publicProcedure = t.procedure.use((opts) => {
  return opts.next({ ...opts })
})

export const protectedProcedure = t.procedure.use((opts) => {
  if (!opts.ctx.session?.user || opts.ctx.session.error) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  return opts.next({
    ...opts,
    ctx: {
      ...opts.ctx,
      session: {
        ...opts.ctx.session,
        user: opts.ctx.session.user,
      },
    },
  })
})

export const mergeRouters = t.mergeRouters
