import { FundSlug } from '@prisma/client'
import sanitize from 'sanitize-filename'

import markdownToHtml from '../../utils/markdownToHtml'
import { fileExists, getSingleFile } from '../../utils/md'
import { fundSlugs } from '../../utils/funds'
import Markdown from '../../components/Markdown'

export default function About({ content }: { content: string }) {
  return <Markdown content={content} />
}

export async function getStaticProps({ params }: { params: { fund: FundSlug } }) {
  const md = getSingleFile(`docs/${sanitize(params.fund)}/about_us.md`)

  const content = await markdownToHtml(md || '')

  return {
    props: {
      content,
    },
  }
}

export function getStaticPaths() {
  return {
    paths: fundSlugs
      .filter((fundSlug) => fileExists(`docs/${sanitize(fundSlug)}/about_us.md`))
      .map((fundSlug) => `/${fundSlug}/about`),
    fallback: true,
  }
}
