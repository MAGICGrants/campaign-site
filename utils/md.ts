import fs from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import sanitize from 'sanitize-filename'

const postsDirectory = join(process.cwd(), 'docs/projects')

const FIELDS = ['title',
  'summary',
  'slug',
  'git',
  'content',
  'coverImage',
  'nym',
  'date',
  'goal',
  'website',
  'twitter',
  'personalTwitter',
  'personalWebsite',
  'staticXMRaddress',
  'isFunded',
  'numdonationsxmr',
  'totaldonationsinfiatxmr',
  'totaldonationsxmr',
  'numdonationsbtc',
  'totaldonationsinfiatbtc',
  'totaldonationsbtc',
  'fiatnumdonations',
  'fiattotaldonationsinfiat',
  'fiattotaldonations',
]

export function getPostSlugs() {
  return fs.readdirSync(postsDirectory)
}

export function getSingleFile(path: string) {
  const fullPath = join(process.cwd(), path)
  return fs.readFileSync(fullPath, 'utf8')
}

export function getPostBySlug(slug: string) {
  const fields = FIELDS;
  const realSlug = slug.replace(/\.md$/, '')
  const fullPath = join(postsDirectory, `${sanitize(realSlug)}.md`)
  const fileContents = fs.readFileSync(fullPath, 'utf8')
  const { data, content } = matter(fileContents)

  const items: any = {}

  // Ensure only the minimal needed data is exposed
  fields.forEach((field) => {
    if (field === 'slug') {
      items[field] = realSlug
    }
    if (field === 'content') {
      items[field] = content
    }

    if (typeof data[field] !== 'undefined') {
      items[field] = data[field]
    }
  })

  return items
}

export function getAllPosts() {
  const slugs = getPostSlugs()
  const posts = slugs.map((slug) => getPostBySlug(slug))

  return posts
}
