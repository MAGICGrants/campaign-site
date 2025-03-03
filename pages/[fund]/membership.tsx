import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { faMonero } from '@fortawesome/free-brands-svg-icons'
import { faCreditCard } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { DollarSign } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { FundSlug } from '@prisma/client'
import { GetServerSidePropsContext, GetStaticPropsContext } from 'next'
import Image from 'next/image'
import Head from 'next/head'
import { z } from 'zod'

import {
  MAX_AMOUNT,
  ANNUALLY_MEMBERSHIP_MIN_PRICE_USD,
  MONTHLY_MEMBERSHIP_MIN_PRICE_USD,
} from '../../config'
import Spinner from '../../components/Spinner'
import { trpc } from '../../utils/trpc'
import { useToast } from '../../components/ui/use-toast'
import { Button } from '../../components/ui/button'
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../components/ui/form'
import { Input } from '../../components/ui/input'
import { ProjectItem } from '../../utils/types'
import { funds, fundSlugs } from '../../utils/funds'
import MembershipPerksAside from '../../components/MembershipPerksAside'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'

type QueryParams = { fund: FundSlug; slug: string }
type Props = { project: ProjectItem } & QueryParams

function MembershipPage({ fund: fundSlug, project }: Props) {
  const session = useSession()
  const router = useRouter()

  const schema = z
    .object({
      amount: z.coerce.number(),
      term: z.enum(['monthly', 'annually']),
      taxDeductible: z.enum(['yes', 'no']),
      recurring: z.enum(['yes', 'no']),
      givePointsBack: z.enum(['yes', 'no']),
    })
    .superRefine((data, ctx) => {
      if (data.term === 'monthly' && data.amount < MONTHLY_MEMBERSHIP_MIN_PRICE_USD) {
        ctx.addIssue({
          path: ['amount'],
          code: 'custom',
          message: `Min. monthly amount is $${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}.`,
        })
      }

      if (data.term === 'annually' && data.amount < ANNUALLY_MEMBERSHIP_MIN_PRICE_USD) {
        ctx.addIssue({
          path: ['amount'],
          code: 'custom',
          message: `Min. anually amount is $${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}.`,
        })
      }
    })

  type FormInputs = z.infer<typeof schema>

  const { toast } = useToast()

  const form = useForm<FormInputs>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: 10,
      term: 'monthly',
      taxDeductible: 'no',
      recurring: 'no',
      givePointsBack: 'no',
    },
    mode: 'all',
  })

  const payMembershipWithFiatMutation = trpc.donation.payMembershipWithFiat.useMutation()
  const payMembershipWithCryptoMutation = trpc.donation.payMembershipWithCrypto.useMutation()

  const userHasMembershipQuery = trpc.donation.userHasMembership.useQuery(
    { projectSlug: fundSlug },
    { enabled: false }
  )

  useEffect(() => {
    if (session.status === 'authenticated') {
      userHasMembershipQuery.refetch()
    }
  }, [session.status])

  async function handleBtcPay(data: FormInputs) {
    if (!project) return
    if (!fundSlug) return

    try {
      const result = await payMembershipWithCryptoMutation.mutateAsync({
        fundSlug,
        amount: data.amount,
        term: data.term,
        taxDeductible: data.taxDeductible === 'yes',
        givePointsBack: data.givePointsBack === 'yes',
      })

      window.location.assign(result.url)
    } catch (e) {
      toast({ title: 'Error', description: 'Sorry, something went wrong.', variant: 'destructive' })
    }
  }

  async function handleFiat(data: FormInputs) {
    if (!project) return
    if (!fundSlug) return

    try {
      const result = await payMembershipWithFiatMutation.mutateAsync({
        fundSlug,
        amount: data.amount,
        term: data.term,
        recurring: data.recurring === 'yes',
        taxDeductible: data.taxDeductible === 'yes',
        givePointsBack: data.givePointsBack === 'yes',
      })

      if (!result.url) throw new Error()

      window.location.assign(result.url)
    } catch (e) {
      toast({ title: 'Error', description: 'Sorry, something went wrong.', variant: 'destructive' })
    }
  }

  useEffect(() => {
    if (session.status === 'unauthenticated') {
      router.push(`/${fundSlug}/register?nextAction=membership`)
      return
    }

    if (userHasMembershipQuery.data === true) {
      router.push(`/${fundSlug}`)
      return
    }
  }, [session, userHasMembershipQuery.data])

  const amount = form.watch('amount')
  const term = form.watch('term')
  const annualTermSavePerc =
    amount < 100 && term === 'monthly'
      ? Math.round(((amount * 12 - ANNUALLY_MEMBERSHIP_MIN_PRICE_USD) / (amount * 12)) * 100)
      : 0

  useEffect(() => {
    const newAmount =
      term === 'monthly' ? MONTHLY_MEMBERSHIP_MIN_PRICE_USD : ANNUALLY_MEMBERSHIP_MIN_PRICE_USD
    form.setValue('amount', newAmount)
  }, [term])

  if (!project || session.status === 'loading') return <></>

  return (
    <>
      <Head>
        <title>Membership to {project.title}</title>
      </Head>

      <div className="w-full flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0 justify-center items-center sm:items-start">
        <MembershipPerksAside />

        <div className="max-w-[540px] mx-auto p-6 space-y-6 rounded-lg bg-white">
          <div className="py-4 flex flex-col space-y-6">
            <div className="flex flex-col items-center sm:space-x-4 sm:flex-row">
              <Image
                alt={project.title}
                src={project.coverImage}
                width={200}
                height={96}
                objectFit="cover"
                className="w-36 rounded-lg"
              />
              <div className="flex flex-col justify-center text-center sm:text-left">
                <h2 className="font-semibold">Membership to {project.title}</h2>
                <h3 className="text-gray-500">Pledge your support</h3>
              </div>
            </div>
          </div>

          <Form {...form}>
            <form className="flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row sm:space-x-2 space-y-2 sm:space-y-0">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormLabel>Amount</FormLabel>
                      <FormDescription>You choose it!</FormDescription>
                      <FormControl>
                        <Input
                          className="w-40 mr-auto"
                          type="number"
                          inputMode="numeric"
                          leftIcon={DollarSign}
                          {...field}
                        />
                      </FormControl>

                      <FormMessage />

                      {!form.formState.errors.amount?.message && (
                        <p className="text-xs hidden sm:block">&emsp;</p>
                      )}
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="term"
                  render={({ field }) => (
                    <FormItem className="flex flex-col space-y-0 justify-end">
                      <FormLabel className="hidden sm:block">&emsp;</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl className="w-28">
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="annually">Annually</SelectItem>
                        </SelectContent>
                      </Select>

                      {annualTermSavePerc > 0 && (
                        <span className="font-semibold text-teal-500 text-xs">
                          Save {annualTermSavePerc}% with <strong>annual</strong>
                        </span>
                      )}
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="taxDeductible"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>
                      Do you want your membership to be tax deductible? (US only)
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-row space-x-4 text-gray-700"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="no" />
                          </FormControl>
                          <FormLabel className="font-normal">No</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="yes" />
                          </FormControl>
                          <FormLabel className="font-normal">Yes</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="recurring"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>
                      Do you want your membership payment to be recurring? (Fiat only)
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-row space-x-4 text-gray-700"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="no" />
                          </FormControl>
                          <FormLabel className="font-normal">No</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="yes" />
                          </FormControl>
                          <FormLabel className="font-normal">Yes</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="givePointsBack"
                render={({ field }) => (
                  <FormItem className="space-y-3 leading-5">
                    <FormLabel>
                      Would you like to receive MAGIC Grants points back for your donation? The
                      points can be redeemed for various donation perks as a thank you for
                      supporting our mission.
                    </FormLabel>

                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col"
                      >
                        <FormItem className="flex items-start space-x-3 space-y-0">
                          <FormControl className="flex-shrink-0">
                            <RadioGroupItem value="yes" />
                          </FormControl>

                          <FormLabel className="font-normal text-gray-700">
                            Yes, give me perks! This will reduce the donation amount by 10%, the
                            approximate value of the points when redeemed for goods/services.
                          </FormLabel>
                        </FormItem>

                        <FormItem className="flex items-start space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="no" />
                          </FormControl>

                          <FormLabel className="font-normal text-gray-700">
                            No, use my full contribution toward your mission.
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="mt-4 flex flex-col sm:flex-row space-y-2 sm:space-x-2 sm:space-y-0">
                <Button
                  type="button"
                  onClick={form.handleSubmit(handleBtcPay)}
                  disabled={!form.formState.isValid || form.formState.isSubmitting}
                  className="grow basis-0"
                >
                  {payMembershipWithCryptoMutation.isPending ? (
                    <Spinner />
                  ) : (
                    <FontAwesomeIcon icon={faMonero} className="h-5 w-5" />
                  )}
                  Pay with Crypto
                </Button>

                <Button
                  type="button"
                  onClick={form.handleSubmit(handleFiat)}
                  disabled={!form.formState.isValid || form.formState.isSubmitting}
                  className="grow basis-0 bg-indigo-500 hover:bg-indigo-700"
                >
                  {payMembershipWithFiatMutation.isPending ? (
                    <Spinner className="fill-indigo-500" />
                  ) : (
                    <FontAwesomeIcon icon={faCreditCard} className="h-5 w-5" />
                  )}
                  Pay with Card
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </>
  )
}

export default MembershipPage

export async function getStaticPaths() {
  return {
    paths: fundSlugs.map((fund) => `/${fund}/membership`),
    fallback: true,
  }
}

export function getStaticProps({ params }: GetStaticPropsContext<QueryParams>) {
  return { props: { ...params, project: funds[params?.fund!] } }
}
