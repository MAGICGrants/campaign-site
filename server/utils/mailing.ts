import { Donation, FundSlug } from '@prisma/client'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import dayjs from 'dayjs'

import { env } from '../../env.mjs'
import { transporter } from '../services'
import { funds } from '../../utils/funds'
import { POINTS_REDEEM_PRICE_USD } from '../../config'
import markdownToHtml from '../../utils/markdownToHtml'
import { DonationCryptoPayments } from '../types'

dayjs.extend(localizedFormat)

const pointsFormat = Intl.NumberFormat('en', { notation: 'standard', compactDisplay: 'long' })

type SendDonationConfirmationEmailParams = {
  to: string
  donorName: string
  donation: Donation
  attestationMessage: string
  attestationSignature: string
}

export async function sendDonationConfirmationEmail({
  to,
  donorName,
  donation,
  attestationMessage,
  attestationSignature,
}: SendDonationConfirmationEmailParams) {
  const dateStr = dayjs().format('YYYY-M-D')
  const fundName = funds[donation.fundSlug].title
  const isMembership = !donation.membershipExpiresAt
  const isSubscription = donation.stripeSubscriptionId
  const isPaidWithCrypto = (donation.cryptoPayments as DonationCryptoPayments | null)?.length
  const cryptoDonationDescription = (donation.cryptoPayments as DonationCryptoPayments | null)
    ?.map((payment) => `${payment.grossAmount} ${payment.cryptoCode}`)
    .join(', ')

  const markdown = `# Donation receipt
  
  Thank you for your donation to MAGIC Grants! Your donation supports our charitable mission.

  ${isMembership ? `You donated to: ${fundName}` : ''}

  ${donation.projectName ? `You supported this campaign: ${donation.projectName}` : ''}

  ${
    isMembership
      ? `You purchased an annual membership for the ${fundName}.
  This membership ${isSubscription ? 'will' : 'will not'} renew automatically. Easily manage your membership by logging into your account at donate.magicgrants.org.`
      : ''
  }

  Please see the full details on your donation receipt below:

  MAGIC Grants is a 501(c)(3) public charity. This serves as your donation receipt. Donations to MAGIC Grants are tax deductible to the extent allowable by law.

  Donation Date: ${dateStr}

  Donor Information:
  ${donorName}

  MAGIC Grants acknowledges and expresses appreciation for the following contribution:
  - ${!isPaidWithCrypto ? '☑️' : '⬜'} Cash or bank transfer donation amount: ${!isPaidWithCrypto ? `$${donation.grossFiatAmount}` : '$0.00'}
  - ${isPaidWithCrypto ? '☑️' : '⬜'} In-kind (non-fiat) donation description: ${cryptoDonationDescription ? cryptoDonationDescription : '-'}

  Description and/or restrictions: ${donation.fundSlug === 'general' ? 'None' : `Donation to the ${fundName}`}

  The following describes the context of your donation:

  - ${!donation.pointsAdded ? '☑️' : '⬜'} No goods or services were received in exchange for your generous donation.
  - ${donation.pointsAdded ? '☑️' : '⬜'} In connection with your generous donation, you received ${pointsFormat.format(donation.pointsAdded)} points, valued at approximately $${(donation.pointsAdded * POINTS_REDEEM_PRICE_USD).toFixed(2)}.

  ${isPaidWithCrypto ? 'If you wish to receive a tax deduction for a cryptocurrency donation over $500, you MUST complete [Form 8283](https://www.irs.gov/pub/irs-pdf/f8283.pdf) and send the completed form to [info@magicgrants.org](mailto:info@magicgrants.org) to qualify for a deduction.' : ''}

  ### Signed attestation

  Message
  \`\`\`
  ${attestationMessage}
  \`\`\`

  Signature
  \`\`\`
  ${attestationSignature}
  \`\`\`

  Public key (ED25519)
  \`\`\`
  ${env.NEXT_PUBLIC_ATTESTATION_PUBLIC_KEY_HEX}
  \`\`\`

  This attestation can be verified at [donate.magicgrants.org/${donation.fundSlug}/verify-attestation](https://donate.magicgrants.org/${donation.fundSlug}/verify-attestation).

  MAGIC Grants
  1942 Broadway St., STE 314C
  Boulder, CO 80302
  EIN: 82-5183590
  (303) 900-3237
  info@magicgrants.org`

  const htmlFromMarkdown = await markdownToHtml(markdown)

  const html = `<style>
  html {
    display: flex;
  }

  body {
    max-width: 700px;
    padding: 20px;
    margin: 0 auto;
    font-family: sans-serif;
    background-color: #F1F5FF;
  }

  a {
    color: #3a76f0;
  }

  pre {
    word-break: break-all;
    white-space: pre-wrap;
  }
</style>

${htmlFromMarkdown}`

  return transporter.sendMail({
    from: env.SES_VERIFIED_SENDER,
    to,
    subject: 'Donation confirmation',
    html,
  })
}

type SendPerkPurchaseConfirmationEmailParams = {
  to: string
  perkName: string
  address?: {
    addressLine1: string
    addressLine2?: string
    city: string
    stateCode: string
    countryCode: string
    zip: string
  }
  pointsRedeemed: number
}

export async function sendPerkPurchaseConfirmationEmail({
  to,
  perkName,
  address,
  pointsRedeemed,
}: SendPerkPurchaseConfirmationEmailParams) {
  const markdown = `You redeemed points from MAGIC Grants!

    Redeemed item: ${perkName}
    Number of points redeemed: ${pointsFormat.format(pointsRedeemed)}

    ${
      address
        ? `Mailing address

          Address line 1: ${address.addressLine1}
          Address line 2: ${address.addressLine2 || '-'}
          City: ${address.city}
          State: ${address.stateCode}
          Country: ${address.countryCode}
          Zip: ${address.zip}`
        : ''
    }

  If you did not make this redemption, please contact [info@magicgrants.org](info@magicgrants.org) immediately, since your account may be compromised. Points are not refundable once redeemed. If you have an issue with your order, please contact us.`

  const htmlFromMarkdown = await markdownToHtml(markdown)

  const html = `<style>
    html {
      display: flex;
    }

    body {
      max-width: 700px;
      padding: 20px;
      margin: 0 auto;
      font-family: sans-serif;
      background-color: #F1F5FF;
    }

    a {
      color: #3a76f0;
    }
  </style>

  ${htmlFromMarkdown}`

  return transporter.sendMail({
    from: env.SES_VERIFIED_SENDER,
    to,
    subject: 'Perk purchase confirmation',
    html,
  })
}

type SendPackageTrackingInfoParams = {
  to: string
  perkName: string
  carrier: string
  trackingUrl: string
  trackingNumber: string
}

export async function sendPackageTrackingInfo({
  to,
  perkName,
  carrier,
  trackingUrl,
  trackingNumber,
}: SendPackageTrackingInfoParams) {
  const markdown = `### Your package has been shipped!

  Redeemed item: ${perkName}  
  Carrier: ${carrier}  
  Tracking number: ${trackingNumber}  
  [Track my order](${trackingUrl})  

  Please contact [info@magicgrants.org](info@magicgrants.org) if you have any questions.`

  const htmlFromMarkdown = await markdownToHtml(markdown)

  const html = `<style>
    html {
      display: flex;
    }

    body {
      max-width: 700px;
      padding: 20px;
      margin: 0 auto;
      font-family: sans-serif;
      background-color: #F1F5FF;
    }

    a {
      color: #3a76f0;
    }
  </style>

  ${htmlFromMarkdown}`

  return transporter.sendMail({
    from: env.SES_VERIFIED_SENDER,
    to,
    subject: 'Your package has been shipped!',
    html,
  })
}
