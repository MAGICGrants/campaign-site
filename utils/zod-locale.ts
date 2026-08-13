import { z } from 'zod'

type Issue = {
  readonly code: string
  readonly origin?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly inclusive?: boolean
  readonly expected?: string
  readonly format?: string
  readonly input?: unknown
}

/**
 * Friendlier copy for forms. Return `undefined` to fall back to Zod’s English locale.
 *
 * Zod’s bundled `en` locale still uses technical wording (e.g. “Too small: expected string…”);
 * `customError` runs first in `finalizeIssue`, so we override only what we need.
 */
function formFriendlyError(iss: Issue): string | undefined {
  switch (iss.code) {
    case 'too_small': {
      const min = iss.minimum ?? 0
      const inclusive = iss.inclusive !== false

      if (iss.origin === 'string') {
        if (inclusive && min === 1) return 'This field is required.'
        if (inclusive && min > 1) return `Enter at least ${min} characters.`
        if (!inclusive && min >= 0) return `Enter more than ${min} characters.`
      }

      if (iss.origin === 'number') {
        if (inclusive) return `Enter a number of at least ${min}.`
        return `Enter a number greater than ${min}.`
      }

      if (iss.origin === 'array') {
        return `Choose at least ${min} item${min === 1 ? '' : 's'}.`
      }

      return undefined
    }
    case 'too_big': {
      const max = iss.maximum ?? 0
      const inclusive = iss.inclusive !== false

      if (iss.origin === 'string') {
        if (inclusive) return `Enter at most ${max} characters.`
        return `Enter fewer than ${max} characters.`
      }

      if (iss.origin === 'number') {
        if (inclusive) return `Enter a number of at most ${max}.`
        return `Enter a number less than ${max}.`
      }

      return undefined
    }
    case 'invalid_type': {
      const input = iss.input
      if (iss.expected === 'string' && (input === undefined || input === null || input === '')) {
        return 'This field is required.'
      }
      return undefined
    }
    case 'invalid_format': {
      if (iss.format === 'email') return 'Enter a valid email address.'
      return undefined
    }
    default:
      return undefined
  }
}

z.config({
  customError: (iss) => formFriendlyError(iss as Issue) ?? undefined,
})
