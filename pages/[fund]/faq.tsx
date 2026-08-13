import { FundSlug } from '@prisma/client'
import sanitize from 'sanitize-filename'

import markdownToHtml from '../../utils/markdownToHtml'
import { fileExists, getSingleFile } from '../../utils/md'
import { fundSlugs } from '../../utils/funds'
import Markdown from '../../components/Markdown'

export default function Faq({ content }: { content: string }) {
  return <Markdown content={content} />
}

export async function getStaticProps({ params }: { params: { fund: FundSlug } }) {
  const md = getSingleFile(`docs/${sanitize(params.fund)}/faq.md`)

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
      .filter((fundSlug) => fileExists(`docs/${sanitize(fundSlug)}/faq.md`))
      .map((fundSlug) => `/${fundSlug}/faq`),
    fallback: true,
  }
}
