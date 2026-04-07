import './zod-locale'
import { z } from 'zod'

import {
  ANNUALLY_MEMBERSHIP_MIN_PRICE_USD,
  MAX_AMOUNT,
  MIN_AMOUNT,
  MONTHLY_MEMBERSHIP_MIN_PRICE_USD,
} from '../config'

/** Letters (Unicode), combining marks, spaces, hyphen, apostrophe, period — no digits or @ etc. */
export const personNameRegex = /^[\p{L}\p{M}\s'.-]+$/u

export const personNameFormatMessage =
  'Use letters only; spaces, hyphens, apostrophes, and periods are allowed.'

export const zPersonNamePart = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(personNameRegex, personNameFormatMessage)

/** Trim + lowercase email (shared by auth, account, login forms, etc.). */
export const zEmailNormalized = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase())
  .pipe(z.email())

export const registerAddressSchema = z
  .object({
    addressLine1: z.string().trim().max(200),
    addressLine2: z.string().trim().max(200),
    city: z.string().trim().max(200),
    state: z.string().trim().max(200),
    country: z.string().trim().max(200),
    zip: z.string().trim().max(32),
    _addressStateOptionsLength: z.number().int().min(0),
  })
  .superRefine((data, ctx) => {
    if (!data.state && data._addressStateOptionsLength) {
      ctx.addIssue({
        path: ['shippingState'],
        code: 'custom',
        message: 'State is required.',
      })
    }
  })

type RegisterPasswordFields = { password: string; confirmPassword: string }

type RegisterAddressRefinement = {
  _addMailingAddress: boolean
  address: {
    addressLine1: string
    country: string
    city: string
    zip: string
  }
}

/** Password match + conditional mailing address (register form + `auth.register`). */
export function applyRegisterRefinements<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (data) => {
        const d = data as RegisterPasswordFields
        return d.password === d.confirmPassword
      },
      {
        message: 'Passwords do not match.',
        path: ['confirmPassword'],
      }
    )
    .superRefine((data, ctx) => {
      const d = data as RegisterAddressRefinement
      if (d._addMailingAddress) {
        if (!d.address.addressLine1) {
          ctx.addIssue({
            path: ['shipping.addressLine1'],
            code: 'custom',
            message: 'Address line 1 is required.',
          })
        }

        if (!d.address.country) {
          ctx.addIssue({
            path: ['shipping.country'],
            code: 'custom',
            message: 'Country is required.',
          })
        }

        if (!d.address.city) {
          ctx.addIssue({
            path: ['shipping.city'],
            code: 'custom',
            message: 'City is required.',
          })
        }

        if (!d.address.zip) {
          ctx.addIssue({
            path: ['shipping.zip'],
            code: 'custom',
            message: 'Postal code is required.',
          })
        }
      }
    })
}

export const zGuestDonorName = z.union([
  z.null(),
  z.string().trim().min(1).max(200).regex(personNameRegex, personNameFormatMessage),
])

export const zDonationEmail = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.union([z.null(), z.email()])
)

export const zDonationAmount = z.number().min(MIN_AMOUNT).max(MAX_AMOUNT)

export const zProjectName = z.string().trim().min(1).max(200)

export const zProjectSlug = z.string().trim().min(1).max(120)

export const zFormDonorName = z.union([
  z.literal(''),
  z.string().trim().min(1).max(200).regex(personNameRegex, personNameFormatMessage),
])

export const zFormDonorEmail = z.union([z.literal(''), zEmailNormalized])

export function refineMembershipAmount(
  data: { term: 'monthly' | 'annually'; amount: number },
  ctx: z.RefinementCtx
) {
  const min =
    data.term === 'monthly' ? MONTHLY_MEMBERSHIP_MIN_PRICE_USD : ANNUALLY_MEMBERSHIP_MIN_PRICE_USD
  if (data.amount < min) {
    ctx.addIssue({
      code: 'custom',
      path: ['amount'],
      message:
        data.term === 'monthly'
          ? `Min. monthly amount is $${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}.`
          : `Min. annual amount is $${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}.`,
    })
  }
}

export const membershipFormSchema = z
  .object({
    amount: z.coerce.number<number>().min(0).max(MAX_AMOUNT),
    paymentMethod: z.enum(['card', 'btc', 'xmr', 'ltc', 'evm']),
    term: z.enum(['monthly', 'annually']),
    taxDeductible: z.enum(['yes', 'no']),
    recurring: z.enum(['yes', 'no']),
    givePointsBack: z.enum(['yes', 'no']),
  })
  .superRefine(refineMembershipAmount)

/** Donation page form — `isAuthed` toggles guest-only refinements. */
export function donationPageFormSchema(isAuthed: boolean) {
  return z
    .object({
      name: zFormDonorName,
      email: zFormDonorEmail,
      amount: z.coerce.number<number>().min(MIN_AMOUNT).max(MAX_AMOUNT),
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
}
