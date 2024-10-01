import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Head from 'next/head'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../components/ui/form'
import { Input } from '../../../components/ui/input'
import { useForm } from 'react-hook-form'
import { Button } from '../../../components/ui/button'
import Spinner from '../../../components/Spinner'
import { toast } from '../../../components/ui/use-toast'
import { trpc } from '../../../utils/trpc'

const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
    confirmNewPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Passwords do not match.',
    path: ['confirmNewPassword'],
  })

type ChangePasswordFormInputs = z.infer<typeof changePasswordFormSchema>

function Settings() {
  const changePassword = trpc.account.changePassword.useMutation()

  const changePasswordForm = useForm<ChangePasswordFormInputs>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    },
    mode: 'all',
  })

  async function onChangePasswordSubmit(data: ChangePasswordFormInputs) {
    try {
      await changePassword.mutateAsync({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      })

      changePasswordForm.reset()

      toast({ title: 'Password successfully changed!' })
    } catch (error) {
      const errorMessage = (error as any).message

      if (errorMessage === 'INVALID_PASSWORD') {
        return changePasswordForm.setError(
          'currentPassword',
          { message: 'Invalid password.' },
          { shouldFocus: true }
        )
      }

      return toast({
        title: 'Sorry, something went wrong.',
        variant: 'destructive',
      })
    }
  }

  return (
    <>
      <Head>
        <title>MAGIC Grants - Settings</title>
      </Head>

      <div className="w-full max-w-xl mx-auto flex flex-col">
        <h1 className="font-semibold">Change Password</h1>

        <Form {...changePasswordForm}>
          <form
            onSubmit={changePasswordForm.handleSubmit(onChangePasswordSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={changePasswordForm.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={changePasswordForm.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={changePasswordForm.control}
              name="confirmNewPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              disabled={
                changePasswordForm.formState.isSubmitting || !changePasswordForm.formState.isValid
              }
            >
              {changePasswordForm.formState.isSubmitting && <Spinner />} Change Password
            </Button>
          </form>
        </Form>
      </div>
    </>
  )
}

export default Settings
