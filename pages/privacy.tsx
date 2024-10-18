import { FundSlug } from '@prisma/client'

import markdownToHtml from '../utils/markdownToHtml'
import { getSingleFile } from '../utils/md'
import BigDumbMarkdown from '../components/BigDumbMarkdown'

export default function Privacy({ content }: { content: string }) {
  return <BigDumbMarkdown content={content} />
}

export async function getStaticProps({ params }: { params: { fund: FundSlug } }) {
  const md = getSingleFile(`docs/privacy.md`)

  const content = await markdownToHtml(md || '')

  return {
    props: {
      content,
    },
  }
}
