import { SVGProps, useEffect, useRef, useState } from 'react'
import { GetStaticPropsContext } from 'next'
import Link from 'next/link'
import Head from 'next/head'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CreditCardIcon, DollarSign, Info } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { FundSlug } from '@prisma/client'
import { z } from 'zod'
import Image from 'next/image'

import { MAX_AMOUNT } from '../../../config'
import { trpc } from '../../../utils/trpc'
import Spinner from '../../../components/Spinner'
import { useToast } from '../../../components/ui/use-toast'
import { Button } from '../../../components/ui/button'
import { RadioGroup, RadioGroupItem } from '../../../components/ui/radio-group'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../components/ui/form'
import { Input } from '../../../components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert'
import CustomLink from '../../../components/CustomLink'
import { getProjectBySlug, getProjects } from '../../../utils/md'
import { funds, fundSlugs } from '../../../utils/funds'
import { ProjectItem } from '../../../utils/types'
import MoneroLogo from '../../../components/MoneroLogo'
import FiroLogo from '../../../components/FiroLogo'
import PrivacyGuidesLogo from '../../../components/PrivacyGuidesLogo'
import MagicLogo from '../../../components/MagicLogo'
import LitecoinLogo from '../../../components/LitecoinLogo'
import BitcoinLogo from '../../../components/BitcoinLogo'
import EvmIcon from '../../../components/EvmIcon'

type QueryParams = { fund?: FundSlug; slug?: string }
type Props = { project?: ProjectItem } & QueryParams

const placeholderImages: Record<FundSlug, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  monero: MoneroLogo,
  firo: FiroLogo,
  privacyguides: PrivacyGuidesLogo,
  general: MagicLogo,
}

const paymentMethodOptions = [
  { label: 'Credit Card', icon: CreditCardIcon, value: 'card' },
  { label: 'Monero', icon: MoneroLogo, value: 'xmr' },
  { label: 'Bitcoin', icon: BitcoinLogo, value: 'btc' },
  { label: 'Litecoin', icon: LitecoinLogo, value: 'ltc' },
  { label: 'EVMs', icon: EvmIcon, value: 'evm' },
] as const

function DonationPage({ fund: fundSlug, slug, project, ...props }: Props) {
  const session = useSession()
  const isAuthed = session.status === 'authenticated'

  let PlaceholderImage = project ? placeholderImages[project.fund] : placeholderImages.general

  const schema = z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      amount: z.coerce.number().min(1).max(MAX_AMOUNT),
      paymentMethod: z.enum(['card', 'btc', 'xmr', 'ltc', 'evm']),
      taxDeductible: z.enum(['yes', 'no']),
      givePointsBack: z.enum(['yes', 'no']),
      showDonorNameOnLeaderboard: z.enum(['yes', 'no']),
    })
    .refine(
      (data) => (!isAuthed && data.showDonorNameOnLeaderboard === 'yes' ? !!data.name : true),
      { message: 'Name is required when you want it to be on the leaderboard.', path: ['name'] }
    )
    .refine((data) => (!isAuthed && data.taxDeductible === 'yes' ? !!data.name : true), {
      message: 'Name is required when the donation is tax deductible.',
      path: ['name'],
    })
    .refine((data) => (!isAuthed && data.taxDeductible === 'yes' ? !!data.email : true), {
      message: 'Email is required when the donation is tax deductible.',
      path: ['email'],
    })

  type FormInputs = z.infer<typeof schema>

  const { toast } = useToast()

  const form = useForm<FormInputs>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      amount: '' as unknown as number, // a trick to get trigger to work when amount is empty
      taxDeductible: 'no',
      givePointsBack: 'no',
      showDonorNameOnLeaderboard: 'no',
    },
    mode: 'onChange',
  })

  const amount = form.watch('amount')
  const paymentMethod = form.watch('paymentMethod')
  const taxDeductible = form.watch('taxDeductible')
  const showDonorNameOnLeaderboard = form.watch('showDonorNameOnLeaderboard')

  const donateWithFiatMutation = trpc.donation.donateWithFiat.useMutation()
  const donateWithCryptoMutation = trpc.donation.donateWithCrypto.useMutation()

  async function handleSubmit(data: FormInputs) {
    if (!project) return
    if (!fundSlug) return

    const args = {
      email: data.email || null,
      name: data.name || null,
      amount: data.amount,
      projectSlug: project.slug,
      projectName: project.title,
      fundSlug,
      taxDeductible: data.taxDeductible === 'yes',
      givePointsBack: data.givePointsBack === 'yes',
      showDonorNameOnLeaderboard: data.showDonorNameOnLeaderboard === 'yes',
    }

    try {
      if (data.paymentMethod !== 'card') {
        const result = await donateWithCryptoMutation.mutateAsync({
          ...args,
          paymentMethod: data.paymentMethod,
        })
        window.location.assign(result.url)
      }

      if (data.paymentMethod === 'card') {
        const result = await donateWithFiatMutation.mutateAsync({ ...args })
        window.location.assign(result.url!)
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Sorry, something went wrong.', variant: 'destructive' })
    }
  }

  useEffect(() => {
    form.trigger('email', { shouldFocus: true })
    form.trigger('name', { shouldFocus: true })
  }, [taxDeductible, showDonorNameOnLeaderboard])

  if (!project) return <></>

  return (
    <>
      <Head>
        <title>Donate to {project.title}</title>
      </Head>
      <div className="max-w-[540px] mx-auto p-6 space-y-6 rounded-lg bg-white">
        <div className="py-4 flex flex-col space-y-6">
          <div className="flex flex-col items-center sm:space-x-4 sm:flex-row">
            {project.coverImage ? (
              <Image
                alt={project.title}
                src={project.coverImage}
                width={200}
                height={96}
                objectFit="cover"
                className="w-36 rounded-lg"
              />
            ) : (
              <div className="w-52">
                <PlaceholderImage className="w-20 h-20 m-auto" />
              </div>
            )}

            <div className="flex flex-col justify-center">
              <h2 className="text-center sm:text-left font-semibold">Donate to {project.title}</h2>
              <h3 className="text-gray-500">Pledge your support</h3>
            </div>
          </div>
        </div>

        <Form {...form}>
          <form className="flex flex-col gap-6">
            {!isAuthed && (
              <>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Name{' '}
                        {taxDeductible === 'no' &&
                          showDonorNameOnLeaderboard === 'no' &&
                          '(optional)'}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email {taxDeductible === 'no' && '(optional)'}</FormLabel>
                      <FormControl>
                        <Input placeholder="johndoe@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <div className="flex flex-row gap-2 items-center flex-wrap ">
                      <Input
                        className="w-40 mr-auto"
                        type="number"
                        inputMode="numeric"
                        leftIcon={DollarSign}
                        {...field}
                      />

                      {[50, 100, 250, 500].map((value, index) => (
                        <Button
                          key={`amount-button-${index}`}
                          variant="light"
                          size="sm"
                          type="button"
                          onClick={() => form.setValue('amount', value, { shouldValidate: true })}
                        >
                          ${value}
                        </Button>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method</FormLabel>
                  <FormControl>
                    <div className="flex flex-row gap-2 items-center flex-wrap ">
                      {paymentMethodOptions.map((option, index) => {
                        const Icon = option.icon
                        return (
                          <Button
                            key={`amount-button-${index}`}
                            variant={option.value === paymentMethod ? 'default' : 'light'}
                            size="sm"
                            type="button"
                            onClick={() =>
                              form.setValue('paymentMethod', option.value, { shouldValidate: true })
                            }
                          >
                            <Icon className="w-5 h-5" /> {option.label}
                          </Button>
                        )
                      })}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="taxDeductible"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>
                    Do you want this donation to potentially qualify for a tax deduction? (US only)
                  </FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-row space-x-4"
                    >
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="yes" />
                        </FormControl>
                        <FormLabel className="font-normal text-gray-700">Yes</FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="no" />
                        </FormControl>
                        <FormLabel className="font-normal text-gray-700">No</FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="showDonorNameOnLeaderboard"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Do you want your name to be displayed on the leaderboard?</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-row space-x-4"
                    >
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="yes" />
                        </FormControl>
                        <FormLabel className="font-normal text-gray-700">Yes</FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="no" />
                        </FormControl>
                        <FormLabel className="font-normal text-gray-700">No</FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isAuthed && (
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
            )}

            {amount > 500 && taxDeductible === 'yes' && (
              <Alert>
                <Info className="h-4 w-4 text-primary" />
                <AlertTitle>Heads up!</AlertTitle>
                <AlertDescription>
                  When donating over $500 with crypto, you MUST complete{' '}
                  <CustomLink target="_blank" href="https://www.irs.gov/pub/irs-pdf/f8283.pdf">
                    Form 8283
                  </CustomLink>{' '}
                  and send the completed form to{' '}
                  <CustomLink href={`mailto:info@magicgrants.org`}>info@magicgrants.org</CustomLink>{' '}
                  to qualify for a deduction.
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              onClick={form.handleSubmit(handleSubmit)}
              disabled={!form.formState.isValid || form.formState.isSubmitting}
              className="grow basis-0"
            >
              {donateWithCryptoMutation.isPending && <Spinner />}
              Donate
            </Button>
          </form>
        </Form>

        {!isAuthed && <div className="w-full h-px bg-border" />}

        {!isAuthed && (
          <div className="flex flex-col items-center">
            <p className="text-sm">Want to support more projects and receive optional perks?</p>

            <Link href={`/${encodeURIComponent(fundSlug!)}/register`}>
              <Button type="button" size="lg" variant="link">
                Create an account
              </Button>
            </Link>
          </div>
        )}
      </div>
    </>
  )
}

export default DonationPage

export async function getStaticPaths() {
  const projects = await getProjects()

  return {
    paths: [
      ...fundSlugs.map((fund) => `/${fund}/donate/${fund}`),
      ...projects.map((project) => `/${project.fund}/donate/${project.slug}`),
    ],
    fallback: true,
  }
}

export function getStaticProps({ params }: GetStaticPropsContext<QueryParams>) {
  if (params?.fund === params?.slug && params?.fund) {
    return { props: { ...params, project: funds[params.fund] } }
  }

  const project = getProjectBySlug(params?.slug!, params?.fund!)

  return { props: { ...params, project } }
}
