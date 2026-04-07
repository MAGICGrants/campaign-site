import xss from 'xss'
import { cn } from '../utils/cn'

export default function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <article
      className={cn('prose max-w-3xl mx-auto p-12 bg-white rounded-lg', className)}
      dangerouslySetInnerHTML={{ __html: xss(content) }}
    />
  )
}
