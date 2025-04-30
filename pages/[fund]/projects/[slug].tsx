import { SVGProps } from 'react'
import { FundSlug } from '@prisma/client'
import { useRouter } from 'next/router'
import { GetServerSidePropsContext, NextPage } from 'next/types'
import Head from 'next/head'
import ErrorPage from 'next/error'
import Link from 'next/link'
import Image from 'next/image'
import xss from 'xss'

import { ProjectDonationStats, ProjectItem } from '../../../utils/types'
import { getProjectBySlug } from '../../../utils/md'
import markdownToHtml from '../../../utils/markdownToHtml'
import PageHeading from '../../../components/PageHeading'
import Progress from '../../../components/Progress'
import { prisma } from '../../../server/services'
import { Button } from '../../../components/ui/button'
import { trpc } from '../../../utils/trpc'
import { funds, getFundSlugFromUrlPath } from '../../../utils/funds'
import { useFundSlug } from '../../../utils/use-fund-slug'
import { Table, TableBody, TableCell, TableRow } from '../../../components/ui/table'
import { cn } from '../../../utils/cn'
import { DonationCryptoPayments } from '../../../server/types'
import { formatBtc, formatUsd } from '../../../utils/money-formating'
import MagicLogo from '../../../components/MagicLogo'
import MoneroLogo from '../../../components/MoneroLogo'
import FiroLogo from '../../../components/FiroLogo'
import PrivacyGuidesLogo from '../../../components/PrivacyGuidesLogo'

type SingleProjectPageProps = {
  project: ProjectItem
  projects: ProjectItem[]
  donationStats: ProjectDonationStats
}

const placeholderImages: Record<FundSlug, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  monero: MoneroLogo,
  firo: FiroLogo,
  privacyguides: PrivacyGuidesLogo,
  general: MagicLogo,
}

const Project: NextPage<SingleProjectPageProps> = ({ project, donationStats }) => {
  const router = useRouter()
  const fundSlug = useFundSlug()

  const { slug, title, summary, coverImage, content, nym, website, goal, isFunded } = project

  if (!router.isFallback && !slug) {
    return <ErrorPage statusCode={404} />
  }

  const leaderboardQuery = trpc.leaderboard.getLeaderboard.useQuery({
    fundSlug: fundSlug || 'general',
    projectSlug: project.slug,
  })

  const totalFiatAmount =
    donationStats.xmr.fiatAmount +
    donationStats.btc.fiatAmount +
    donationStats.ltc.fiatAmount +
    donationStats.evm.fiatAmount +
    donationStats.usd.fiatAmount

  const totalDonationCount =
    donationStats.xmr.count +
    donationStats.btc.count +
    donationStats.ltc.count +
    donationStats.evm.count +
    donationStats.manual.count +
    donationStats.usd.count

  return (
    <>
      <Head>
        <title>
          {project.title} - {funds[project.fund].title}
        </title>
      </Head>

      <div className="divide-y divide-gray-200">
        <PageHeading project={project}>
          <div className="w-full flex flex-col items-center gap-4">
            {coverImage && (
              <Image
                src={coverImage}
                alt="avatar"
                width={700}
                height={700}
                className="w-full max-w-96 mx-auto object-contain md:hidden"
              />
            )}

            <div className="w-full max-w-96 space-y-6 p-6 bg-white rounded-lg">
              {!project.isFunded && (
                <div className="w-full">
                  <Link href={`/${fundSlug}/donate/${project.slug}`}>
                    <Button className="w-full">Donate</Button>
                  </Link>
                </div>
              )}

              <Progress current={totalFiatAmount} goal={goal} />

              <ul className="font-semibold">
                <li className="flex items-center space-x-1">
                  <span className="text-green-500 text-xl">{`${formatUsd(totalFiatAmount)}`}</span>{' '}
                  <span className="font-normal text-sm text-gray">
                    in {totalDonationCount} donations total
                  </span>
                </li>
                <li>
                  {donationStats.xmr.amount.toFixed(2)} XMR{' '}
                  <span className="font-normal text-sm text-gray">
                    in {donationStats.xmr.count} donations
                  </span>
                </li>
                <li>
                  {formatBtc(donationStats.btc.amount)}{' '}
                  <span className="font-normal text-sm text-gray">
                    in {donationStats.btc.count} donations
                  </span>
                </li>
                <li>
                  {donationStats.ltc.amount.toFixed(2)} LTC{' '}
                  <span className="font-normal text-sm text-gray">
                    in {donationStats.ltc.count} donations
                  </span>
                </li>
                <li>
                  {formatUsd(donationStats.evm.amount)}{' '}
                  <span className="font-normal text-sm text-gray">
                    in {donationStats.evm.count} EVM token donations
                  </span>
                </li>
                <li>
                  {formatUsd(donationStats.usd.amount + donationStats.manual.fiatAmount)}{' '}
                  <span className="font-normal text-sm text-gray">
                    in {donationStats.usd.count + donationStats.manual.count} donations
                  </span>
                </li>
              </ul>
            </div>

            <div className="w-full max-w-96 min-h-72 space-y-4 p-6 bg-white rounded-lg">
              <h1 className="font-bold">Leaderboard</h1>

              {leaderboardQuery.data?.length ? (
                <Table>
                  <TableBody>
                    {leaderboardQuery.data.map((leaderboardItem, index) => (
                      <TableRow
                        key={`leaderboard-item-${leaderboardItem.name}-${leaderboardItem.amount}`}
                      >
                        <TableCell>
                          <div
                            className={cn(
                              'w-8 h-8 flex font-bold text-primary rounded-full',
                              1 ? 'bg-primary/15' : ''
                            )}
                          >
                            <span className="m-auto">{index + 1}</span>
                          </div>
                        </TableCell>
                        <TableCell className="w-full font-medium">{leaderboardItem.name}</TableCell>
                        <TableCell className="font-bold text-green-500">
                          {formatUsd(leaderboardItem.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <span className="text-muted-foreground">No donations</span>
              )}
            </div>
          </div>

          <article
            className="prose max-w-none mt-4 p-6 col-span-2 bg-white rounded-lg"
            dangerouslySetInnerHTML={{ __html: xss(content || '') }}
          />
        </PageHeading>
      </div>
    </>
  )
}

export default Project

export async function getServerSideProps({ params, resolvedUrl }: GetServerSidePropsContext) {
  const fundSlug = getFundSlugFromUrlPath(resolvedUrl)

  if (!params?.slug) return {}
  if (!fundSlug) return {}

  const project = getProjectBySlug(params.slug as string, fundSlug)
  const content = await markdownToHtml(project.content || '')

  const donationStats = {
    xmr: {
      count: project.isFunded ? project.numDonationsXMR : 0,
      amount: project.isFunded ? project.totalDonationsXMR : 0,
      fiatAmount: project.isFunded ? project.totalDonationsXMRInFiat : 0,
    },
    btc: {
      count: project.isFunded ? project.numDonationsBTC : 0,
      amount: project.isFunded ? project.totalDonationsBTC : 0,
      fiatAmount: project.isFunded ? project.totalDonationsBTCInFiat : 0,
    },
    ltc: {
      count: project.isFunded ? project.numDonationsLTC : 0,
      amount: project.isFunded ? project.totalDonationsLTC : 0,
      fiatAmount: project.isFunded ? project.totalDonationsLTCInFiat : 0,
    },
    evm: {
      count: project.isFunded ? project.numDonationsEVM : 0,
      amount: project.isFunded ? project.totalDonationsEVM : 0,
      fiatAmount: project.isFunded ? project.totalDonationsEVMInFiat : 0,
    },
    manual: {
      count: project.isFunded ? project.numDonationsManual : 0,
      amount: project.isFunded ? project.totalDonationsManual : 0,
      fiatAmount: project.isFunded ? project.totalDonationsManual : 0,
    },
    usd: {
      count: project.isFunded ? project.numDonationsFiat : 0,
      amount: project.isFunded ? project.totalDonationsFiat : 0,
      fiatAmount: project.isFunded ? project.totalDonationsFiat : 0,
    },
  }

  if (!project.isFunded) {
    const donations = await prisma.donation.findMany({
      where: { projectSlug: params.slug as string, fundSlug },
    })

    const cryptoCodeToStats = {
      BTC: donationStats.btc,
      XMR: donationStats.xmr,
      LTC: donationStats.ltc,
      EVM: donationStats.evm,
      MANUAL: donationStats.manual,
    } as const

    donations.forEach((donation) => {
      ;(donation.cryptoPayments as DonationCryptoPayments | null)?.forEach((payment) => {
        if (payment.cryptoCode in cryptoCodeToStats) {
          const stats = cryptoCodeToStats[payment.cryptoCode as keyof typeof cryptoCodeToStats]

          stats.count += 1
          stats.amount += payment.netAmount
          stats.fiatAmount += payment.netAmount * payment.rate
        } else if (donation.coinbaseChargeId) {
          cryptoCodeToStats.EVM.count += 1
          cryptoCodeToStats.EVM.amount += payment.netAmount
          cryptoCodeToStats.EVM.fiatAmount += payment.netAmount * payment.rate
        }
      })

      if (!donation.cryptoPayments) {
        donationStats.usd.count += 1
        donationStats.usd.amount += donation.netFiatAmount
        donationStats.usd.fiatAmount += donation.netFiatAmount
      }
    })
  }

  return { props: { project: { ...project, content }, donationStats } }
}
