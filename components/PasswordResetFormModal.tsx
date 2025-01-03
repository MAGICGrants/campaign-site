import { useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Turnstile, TurnstileInstance } from '@marsidev/react-turnstile'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './ui/form'
import { Button } from './ui/button'
import { useToast } from './ui/use-toast'
import { trpc } from '../utils/trpc'
import Spinner from './Spinner'
import { env } from '../env.mjs'

const schema = z.object({
  turnstileToken: z.string().min(1),
  email: z.string().email(),
})

type PasswordResetFormInputs = z.infer<typeof schema>

type Props = { close: () => void }

function PasswordResetFormModal({ close }: Props) {
  const { toast } = useToast()
  const turnstileRef = useRef<TurnstileInstance | null>()

  const form = useForm<PasswordResetFormInputs>({ resolver: zodResolver(schema) })

  const requestPasswordResetMutation = trpc.auth.requestPasswordReset.useMutation()

  async function onSubmit(data: PasswordResetFormInputs) {
    try {
      await requestPasswordResetMutation.mutateAsync(data)

      toast({ title: 'A password reset link has been sent to your email.' })
      close()
      form.reset({ email: '' })
    } catch (error) {
      toast({ title: 'Sorry, something went wrong.', variant: 'destructive' })
    }

    turnstileRef.current?.reset()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reset Password</DialogTitle>
        <DialogDescription>Recover your account.</DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="johndoe@example.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Turnstile
            ref={turnstileRef}
            siteKey={env.NEXT_PUBLIC_TURNSTILE_SITEKEY}
            onError={() => form.setValue('turnstileToken', '', { shouldValidate: true })}
            onExpire={() => form.setValue('turnstileToken', '', { shouldValidate: true })}
            onSuccess={(token) => form.setValue('turnstileToken', token, { shouldValidate: true })}
          />

          <Button type="submit" disabled={!form.formState.isValid || form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Spinner />} Reset Password
          </Button>
        </form>
      </Form>
    </>
  )
}

export default PasswordResetFormModal
