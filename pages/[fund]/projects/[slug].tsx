import { SVGProps, useState } from 'react'
import { FundSlug } from '@prisma/client'
import { useRouter } from 'next/router'
import { GetServerSidePropsContext, NextPage } from 'next/types'
import { EyeIcon } from 'lucide-react'
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
import { Button } from '../../../components/ui/button'
import { trpc } from '../../../utils/trpc'
import { funds, getFundSlugFromUrlPath } from '../../../utils/funds'
import { useFundSlug } from '../../../utils/use-fund-slug'
import { Table, TableBody, TableCell, TableRow } from '../../../components/ui/table'
import { cn } from '../../../utils/cn'
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
  const [leaderboardItemNamesToReveal, setLeaderboardItemNamesToReveal] = useState<number[]>([])

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
    donationStats.manual.fiatAmount +
    donationStats.usd.fiatAmount

  const totalDonationCount =
    donationStats.xmr.count +
    donationStats.btc.count +
    donationStats.ltc.count +
    donationStats.evm.count +
    donationStats.manual.count +
    donationStats.usd.count

  const hasProfaneNames = !!leaderboardQuery.data?.find((item) => item.nameIsProfane)

  function toggleLeaderboardItemNameVis(itemIndex: number) {
    console.log(leaderboardItemNamesToReveal, itemIndex)
    if (leaderboardItemNamesToReveal.includes(itemIndex)) {
      setLeaderboardItemNamesToReveal((state) => state.filter((index) => index !== itemIndex))
    } else {
      setLeaderboardItemNamesToReveal((state) => [...state, itemIndex])
    }
  }

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
              {hasProfaneNames && (
                <span className="text-muted-foreground text-sm">
                  Hidden names are potentially inappropriate
                </span>
              )}

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
                              index < 3 ? 'bg-primary/15' : ''
                            )}
                          >
                            <span className="m-auto">{index + 1}</span>
                          </div>
                        </TableCell>
                        <TableCell className="w-full font-medium">
                          <div className="w-full h-full flex flex-row items-center">
                            <span
                              className={
                                leaderboardItem.nameIsProfane &&
                                !leaderboardItemNamesToReveal.includes(index)
                                  ? 'max-w-36 truncate blur-sm'
                                  : 'max-w-36 truncate'
                              }
                            >
                              {leaderboardItem.name}
                            </span>

                            {leaderboardItem.nameIsProfane && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="ml-2 text-primary hover:text-primary"
                                onClick={() => toggleLeaderboardItemNameVis(index)}
                              >
                                <EyeIcon size={20} />
                              </Button>
                            )}
                          </div>
                        </TableCell>
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

  if (!/^[a-zA-Z0-9-_]+$/.test(params.slug as string)) {
    return { notFound: true }
  }

  let project: ProjectItem

  try {
    project = await getProjectBySlug(params.slug as string, fundSlug)
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      return { notFound: true }
    }

    throw error
  }

  const content = await markdownToHtml(project.content || '')

  const donationStats = {
    xmr: {
      count: project.numDonationsXMR,
      amount: project.totalDonationsXMR,
      fiatAmount: project.totalDonationsXMRInFiat,
    },
    btc: {
      count: project.numDonationsBTC,
      amount: project.totalDonationsBTC,
      fiatAmount: project.totalDonationsBTCInFiat,
    },
    ltc: {
      count: project.numDonationsLTC,
      amount: project.totalDonationsLTC,
      fiatAmount: project.totalDonationsLTCInFiat,
    },
    evm: {
      count: project.numDonationsEVM,
      amount: project.totalDonationsEVM,
      fiatAmount: project.totalDonationsEVMInFiat,
    },
    manual: {
      count: project.numDonationsManual,
      amount: project.totalDonationsManual,
      fiatAmount: project.totalDonationsManual,
    },
    usd: {
      count: project.numDonationsFiat,
      amount: project.totalDonationsFiat,
      fiatAmount: project.totalDonationsFiat,
    },
  }

  return { props: { project: { ...project, content }, donationStats } }
}
