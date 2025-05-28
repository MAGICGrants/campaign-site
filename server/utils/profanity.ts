import { AxiosResponse } from 'axios'
import { geminiApi } from '../services'
import { log } from '../../utils/logging'

type GeminiGenerateContentBody = { contents: { parts: { text: string }[] }[] }
type GeminiGenerateContentRes = AxiosResponse<{
  candidates: { content: { parts: { text: string }[] } }[]
}>

export async function isNameProfane(name: string) {
  const prompt = `We need you to review the name that the user provided: '${name}'.
    We need you to respond in json with a binary response of '0' (for no) or '1' (for yes) if you
    think that it violates the criteria, and provide a reason. We want to filter profanity and
    variants of it, such as misspellings (e.g. 'h4t3 sp33ch' as a misspelling for 'hate speech').
    First try to detect the language used then translate to english. Be careful with misdetecting
    languages, words in spanish for example may be a offensive in portuguese. Do not filter very
    mild profanity like 'stupid' and 'dumb'. We want to filter most family unfriendly content,
    including sexual content. 'Beautiful woman' is not sexual enough to be filtered. Do not filter
    names like 'gay cowboy', 'trans activist', 'devout catholic' or 'jewish guy'. We do not want to
    filter polite or neutral advertising, such as the (non-offensive) name of a company. We do not
    want to filter most political ideologies, such as 'taxation is theft', but we do want to filter
    racist, sexist, and other offensive ideologies, such as 'women should be in the kitchen'. We do
    not want to filter all names that might be the nickname of a drug but also have other common
    uses. For example, do not filter 'speed' or 'methadone', but do filter 'meth'. You can be more
    permissive for marijuana and alcohol so long as the name isn't otherwise offensive. Filter
    terrorist organizations.`

  let isProfane = false

  try {
    const { data } = await geminiApi.post<{}, GeminiGenerateContentRes, GeminiGenerateContentBody>(
      '',
      { contents: [{ parts: [{ text: prompt }] }] }
    )

    isProfane = !!parseInt(data.candidates[0].content.parts[0].text.match(/\d+/g)?.[0] || '0')
  } catch (error) {
    log(
      'warn',
      "Could not ask Gemini if user's name is profane. Continuing assuming it's not. Cause:"
    )
    console.error(error)
  }

  return isProfane
}
