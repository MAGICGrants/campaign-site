import xss from 'xss'
import markdownStyles from './markdown-styles.module.css'

export default function BigDumbMarkdown({ content }: { content: string }) {
  return (
    <div className="flex flex-col items-center mx-auto px-5 py-6 lg:px-0 rounded-lg bg-white">
      <div className={markdownStyles['markdown']}>
        <div dangerouslySetInnerHTML={{ __html: xss(content) }} />
      </div>
    </div>
  )
}
