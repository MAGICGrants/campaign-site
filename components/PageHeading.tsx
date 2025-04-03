import { networkFor, SocialIcon } from 'react-social-icons'
import { ReactNode, SVGProps } from 'react'
import { FundSlug } from '@prisma/client'
import Image from 'next/image'

import { ProjectItem } from '../utils/types'
import CustomLink from './CustomLink'
import WebIcon from './WebIcon'
import MagicLogo from './MagicLogo'
import MoneroLogo from './MoneroLogo'
import FiroLogo from './FiroLogo'
import PrivacyGuidesLogo from './PrivacyGuidesLogo'

interface Props {
  project: ProjectItem
  children: ReactNode
}

const placeholderImages: Record<FundSlug, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  monero: MoneroLogo,
  firo: FiroLogo,
  privacyguides: PrivacyGuidesLogo,
  general: MagicLogo,
}

export default function PageHeading({ project, children }: Props) {
  const PlaceholderImage = placeholderImages[project.fund]

  return (
    <div className="divide-y divide-gray-200">
      <div className="items-start space-y-2 pb-8 pt-6 md:space-y-5 xl:grid xl:grid-cols-3 xl:gap-x-8">
        {project.coverImage ? (
          <Image
            src={project.coverImage}
            alt="avatar"
            width={300}
            height={300}
            className="h-60 w-60 mx-auto my-auto object-contain row-span-3 hidden xl:block"
          />
        ) : (
          <PlaceholderImage className="w-60 h-60 mx-auto my-auto object-contain row-span-3 hidden xl:block" />
        )}

        <h1 className="text-3xl font-extrabold leading-9 tracking-tight text-gray-900 sm:text-4xl sm:leading-10 md:text-6xl md:leading-14 xl:col-span-2">
          {!!project.website && (
            <CustomLink
              className="text-inherit hover:text-inherit hover:underline"
              href={project.website}
            >
              {project.title}
            </CustomLink>
          )}
          {!project.website && project.title}
        </h1>

        <p>{project.summary}</p>

        <div></div>

        <div className="flex space-x-3 items-center">
          <p>
            by <CustomLink href={project.socialLinks[0]}>{project.nym}</CustomLink>
          </p>

          <div className="flex">
            {project.socialLinks.map((link) =>
              networkFor(link) !== 'sharethis' ? (
                <SocialIcon
                  key={`social-icon-${link}`}
                  url={link}
                  className="text-gray-700 hover:text-primary transition-colors"
                  style={{ width: 40, height: 40 }}
                  fgColor="currentColor"
                  bgColor="transparent"
                />
              ) : (
                <CustomLink
                  key={`social-icon-${link}`}
                  href={link}
                  className="text-gray-700 hover:text-primary"
                >
                  <WebIcon style={{ width: 40, height: 40, padding: 8 }} />
                </CustomLink>
              )
            )}
          </div>
        </div>
      </div>

      <div className="pt-4 items-start space-y-2 xl:grid xl:grid-cols-3 xl:gap-x-4 xl:space-y-0">
        {children}
      </div>
    </div>
  )
}
