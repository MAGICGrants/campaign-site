import * as ed from '@noble/ed25519'
import { Donation, FundSlug, MembershipTerm } from '@prisma/client'
import dayjs from 'dayjs'

import { env } from '../../env.mjs'
import { funds } from '../../utils/funds'

type GetDonationAttestationParams = {
  donorName: string
  donorEmail: string
  donation: Donation
}

export async function getDonationAttestation({
  donorName,
  donorEmail,
  donation,
}: GetDonationAttestationParams) {
  const message = `MAGIC Grants Donation Attestation

Name: ${donorName}
Email: ${donorEmail}
Donation ID: ${donation.id}
Amount: $${donation.grossFiatAmount.toFixed(2)}
Method: ${donation.cryptoPayments ? 'Crypto' : 'Fiat'}
Fund: ${funds[donation.fundSlug].title}
Project: ${donation.projectName}
Date: ${dayjs(donation.createdAt).format('YYYY-M-D')}

Verify this attestation at donate.magicgrants.org/${donation.fundSlug}/verify-attestation`

  const signature = await ed.signAsync(
    Buffer.from(message, 'utf-8').toString('hex'),
    env.ATTESTATION_PRIVATE_KEY_HEX
  )

  const signatureHex = Buffer.from(signature).toString('hex')

  return { message, signature: signatureHex }
}

type GetMembershipAttestation = {
  donorName: string
  donorEmail: string
  donation: Donation
  totalAmountToDate?: number
  periodStart?: Date
}

export async function getMembershipAttestation({
  donorName,
  donorEmail,
  totalAmountToDate,
  donation,
  periodStart,
}: GetMembershipAttestation) {
  const message = `MAGIC Grants Membership Attestation

Name: ${donorName}
Email: ${donorEmail}
Term: ${donation.membershipTerm!.charAt(0).toUpperCase() + donation.membershipTerm!.slice(1)}
Total amount to date: $${(totalAmountToDate || donation.grossFiatAmount).toFixed(2)}
Method: ${donation.cryptoPayments ? 'Crypto' : 'Fiat'}
Fund: ${funds[donation.fundSlug].title}
Period start: ${dayjs(periodStart || donation.createdAt).format('YYYY-M-D')}
Period end: ${dayjs(donation.membershipExpiresAt).format('YYYY-M-D')}

Verify this attestation at donate.magicgrants.org/${donation.fundSlug}/verify-attestation`

  const signature = await ed.signAsync(
    Buffer.from(message, 'utf-8').toString('hex'),
    env.ATTESTATION_PRIVATE_KEY_HEX
  )

  const signatureHex = Buffer.from(signature).toString('hex')

  return { message, signature: signatureHex }
}
