import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { CheckIcon, CopyIcon, XIcon } from 'lucide-react'
import { z } from 'zod'
import * as ed from '@noble/ed25519'

import { Form, FormControl, FormField, FormItem, FormLabel } from '../components/ui/form'
import { Textarea } from '../components/ui/textarea'
import { env } from '../env.mjs'
import { Label } from '../components/ui/label'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { copyToClipboard } from '../server/utils/clipboard'

const schema = z.object({ message: z.string(), signature: z.string() })

type AttestationInputs = z.infer<typeof schema>

function VerifyDonation() {
  const [signatureIsValid, setSignatureIsValid] = useState(false)

  const form = useForm<AttestationInputs>({
    resolver: zodResolver(schema),
    defaultValues: { message: '', signature: '' },
    mode: 'all',
  })

  const message = form.watch('message')
  const signature = form.watch('signature')

  useEffect(() => {
    ;(async () => {
      if (!(message && signature)) return setSignatureIsValid(false)

      try {
        const isValid = await ed.verifyAsync(
          signature,
          Buffer.from(message, 'utf-8').toString('hex'),
          env.NEXT_PUBLIC_ATTESTATION_PUBLIC_KEY_HEX.toLowerCase()
        )

        return setSignatureIsValid(isValid)
      } catch (error) {
        console.log(error)
        setSignatureIsValid(false)
      }
    })()
  }, [message, signature])

  return (
    <div className="w-full max-w-xl m-auto p-6 flex flex-col space-y-4 bg-white rounded-lg">
      <h1 className="font-bold">Verify Attestation</h1>

      <Form {...form}>
        <form className="w-full flex flex-col space-y-4">
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Message</FormLabel>
                <FormControl>
                  <Textarea className="h-56 font-mono" {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="signature"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Signature</FormLabel>
                <FormControl>
                  <Textarea className="h-20 font-mono" {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormItem>
            <FormLabel>Public key (ED25519)</FormLabel>
            <FormControl>
              <div className="space-x-2 flex flex-row items-center">
                <div className="flex flex-col grow">
                  <Input
                    className="w-full font-mono"
                    readOnly
                    value={env.NEXT_PUBLIC_ATTESTATION_PUBLIC_KEY_HEX}
                  />
                </div>

                <Button
                  variant="light"
                  onClick={() => copyToClipboard(env.NEXT_PUBLIC_ATTESTATION_PUBLIC_KEY_HEX)}
                >
                  <CopyIcon size={20} /> Copy
                </Button>
              </div>
            </FormControl>
          </FormItem>

          {!!(message && signature) ? (
            signatureIsValid ? (
              <span className="flex flex-row items-center text-sm self-end text-teal-500 font-semibold">
                <CheckIcon className="mr-2" /> Valid signature
              </span>
            ) : (
              <span className="flex flex-row items-center text-sm self-end text-red-500 font-semibold">
                <XIcon className="mr-2" /> Invalid signature
              </span>
            )
          ) : (
            ''
          )}
        </form>
      </Form>
    </div>
  )
}

export default VerifyDonation
