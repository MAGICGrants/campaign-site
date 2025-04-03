import { useState, useEffect, SVGProps } from 'react'
import { FundSlug } from '@prisma/client'
import Image from 'next/image'
import Link from 'next/link'

import { ProjectItem } from '../utils/types'
import { cn } from '../utils/cn'
import Progress from './Progress'
import MoneroLogo from './MoneroLogo'
import FiroLogo from './FiroLogo'
import PrivacyGuidesLogo from './PrivacyGuidesLogo'
import MagicLogo from './MagicLogo'

const numberFormat = Intl.NumberFormat('en', { notation: 'compact', compactDisplay: 'short' })

export type ProjectCardProps = {
  project: ProjectItem
  customImageStyles?: React.CSSProperties
}

const placeholderImages: Record<FundSlug, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  monero: MoneroLogo,
  firo: FiroLogo,
  privacyguides: PrivacyGuidesLogo,
  general: MagicLogo,
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, customImageStyles }) => {
  const PlaceholderImage = placeholderImages[project.fund]

  return (
    <Link href={`/${project.fund}/projects/${project.slug}`} passHref target="_blank">
      <figure
        className={cn(
          'max-w-sm min-h-[460px] h-full space-y-2 flex flex-col rounded-lg border-b-4 bg-white',
          project.fund === 'monero' && 'border-monero',
          project.fund === 'firo' && 'border-firo',
          project.fund === 'privacyguides' && 'border-privacyguides',
          project.fund === 'general' && 'border-primary'
        )}
      >
        <div className="flex h-48 w-full sm:h-52">
          {project.coverImage ? (
            <Image
              alt={project.title}
              src={project.coverImage}
              width={700}
              height={700}
              style={{ objectFit: 'contain', ...customImageStyles }}
              priority={true}
              className="cursor-pointer rounded-t-xl bg-white"
            />
          ) : (
            <PlaceholderImage className="w-1/2 h-full max-h-full m-auto cursor-pointer rounded-t-xl bg-white" />
          )}
        </div>

        <figcaption className="p-5 flex flex-col grow space-y-4 justify-between">
          <div className="flex flex-col space-y-2">
            <div>
              <h2 className="font-bold">{project.title}</h2>
              <span className="text-sm text-gray-700">by {project.nym}</span>
            </div>

            <span className="line-clamp-3 text-gray-400">{project.summary}</span>

            <span className="font-bold">
              Goal: <span className="text-green-500">${numberFormat.format(project.goal)}</span>
            </span>
          </div>

          <Progress
            current={
              project.totalDonationsBTCInFiat +
              project.totalDonationsXMRInFiat +
              project.totalDonationsFiat
            }
            goal={project.goal}
            percentOnly
          />
        </figcaption>
      </figure>
    </Link>
  )
}

export default ProjectCard
