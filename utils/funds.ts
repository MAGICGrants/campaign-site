import { FundSlug } from '@prisma/client'
import { ProjectItem } from './types'
import { env } from '../env.mjs'

export const funds: Record<FundSlug, ProjectItem & { slug: FundSlug }> = {
  monero: {
    fund: 'monero',
    slug: 'monero',
    nym: 'MagicMonero',
    website: 'https://monerofund.org',
    socialLinks: [
      'https://monerofund.org',
      'https://x.com/magicgrants',
      'https://mastodon.neat.computer/@username',
      'https://github.com/magicgrants',
    ],
    title: 'Monero Fund',
    summary:
      'Help us to provide sustainable funding for free and open-source contributors working on freedom tech and projects that help Monero flourish.',
    coverImage: '/img/crystalball.jpg',
    // The attributes below can be ignored
    date: '',
    goal: 100000,
    numDonationsBTC: 0,
    numDonationsXMR: 0,
    numDonationsFiat: 0,
    totalDonationsBTC: 0,
    totalDonationsXMR: 0,
    totalDonationsFiat: 0,
    totalDonationsBTCInFiat: 0,
    totalDonationsXMRInFiat: 0,
  },
  firo: {
    fund: 'firo',
    slug: 'firo',
    nym: 'MagicFiro',
    website: 'https://monerofund.org',
    socialLinks: [
      'https://monerofund.org',
      'https://x.com/magicgrants',
      'https://mastodon.neat.computer/@username',
      'https://github.com/magicgrants',
    ],
    title: 'Firo Fund',
    summary: 'Support contributors to Firo',
    coverImage: '/img/crystalball.jpg',
    // The attributes below can be ignored
    date: '',
    goal: 100000,
    numDonationsBTC: 0,
    numDonationsXMR: 0,
    numDonationsFiat: 0,
    totalDonationsBTC: 0,
    totalDonationsXMR: 0,
    totalDonationsFiat: 0,
    totalDonationsBTCInFiat: 0,
    totalDonationsXMRInFiat: 0,
  },
  privacyguides: {
    fund: 'privacyguides',
    slug: 'privacyguides',
    nym: 'MagicPrivacyGuides',
    website: 'https://monerofund.org',
    socialLinks: [
      'https://monerofund.org',
      'https://x.com/magicgrants',
      'https://mastodon.neat.computer/@username',
      'https://github.com/magicgrants',
    ],
    title: 'Privacy Guides Fund',
    summary: 'Support contributors to Privacy Guides',
    coverImage: '/img/crystalball.jpg',
    // The attributes below can be ignored
    date: '',
    goal: 100000,
    numDonationsBTC: 0,
    numDonationsXMR: 0,
    numDonationsFiat: 0,
    totalDonationsBTC: 0,
    totalDonationsXMR: 0,
    totalDonationsFiat: 0,
    totalDonationsBTCInFiat: 0,
    totalDonationsXMRInFiat: 0,
  },
  general: {
    fund: 'general',
    slug: 'general',
    nym: 'MagicGeneral',
    website: 'https://monerofund.org',
    socialLinks: [
      'https://monerofund.org',
      'https://x.com/magicgrants',
      'https://mastodon.neat.computer/@username',
      'https://github.com/magicgrants',
    ],
    title: 'General Fund',
    summary: 'Support contributors to MAGIC',
    coverImage: '/img/crystalball.jpg',
    // The attributes below can be ignored
    date: '',
    goal: 100000,
    numDonationsBTC: 0,
    numDonationsXMR: 0,
    numDonationsFiat: 0,
    totalDonationsBTC: 0,
    totalDonationsXMR: 0,
    totalDonationsFiat: 0,
    totalDonationsBTCInFiat: 0,
    totalDonationsXMRInFiat: 0,
  },
}

export const fundSlugToRecipientEmail: Record<FundSlug, string> = {
  monero: env.NEXT_PUBLIC_MONERO_APPLICATION_RECIPIENT,
  firo: env.NEXT_PUBLIC_MONERO_APPLICATION_RECIPIENT,
  privacyguides: env.NEXT_PUBLIC_MONERO_APPLICATION_RECIPIENT,
  general: env.NEXT_PUBLIC_MONERO_APPLICATION_RECIPIENT,
}

export const fundSlugs = Object.keys(funds) as ['monero', 'firo', 'privacyguides', 'general']

export function getFundSlugFromUrlPath(urlPath: string) {
  const fundSlug = urlPath.replace(/(\?.*)$/, '').split('/')[1]

  return fundSlugs.includes(fundSlug as any) ? (fundSlug as FundSlug) : null
}
