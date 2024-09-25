import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'

import { ProjectItem } from '../utils/types'
import { useFundSlug } from '../utils/use-fund-slug'
import Progress from './Progress'
import { StrapiPerk } from '../server/types'
import { env } from '../env.mjs'
import { cn } from '../utils/cn'
import { Dialog, DialogContent } from './ui/dialog'
import PerkPurchaseFormModal from './PerkPurchaseFormModal'

const numberFormat = Intl.NumberFormat('en', { notation: 'compact', compactDisplay: 'short' })

export type Props = { perk: StrapiPerk; balance: number }

const PerkCard: React.FC<Props> = ({ perk, balance }) => {
  const fundSlug = useFundSlug()
  const [purchaseIsOpen, setPurchaseIsOpen] = useState(false)

  return (
    <>
      <figure
        onClick={() => setPurchaseIsOpen(true)}
        className={cn(
          'max-w-sm min-h-[360px] h-full space-y-2 flex flex-col rounded-xl border-b-4 bg-white cursor-pointer',
          fundSlug === 'monero' && 'border-monero',
          fundSlug === 'firo' && 'border-firo',
          fundSlug === 'privacyguides' && 'border-privacyguides',
          fundSlug === 'general' && 'border-primary'
        )}
      >
        <div className="flex h-36 w-full sm:h-52">
          <Image
            alt={perk.name}
            src={env.NEXT_PUBLIC_STRAPI_URL + perk.images[0]!.formats.medium.url}
            width={400}
            height={400}
            style={{ objectFit: 'contain' }}
            className="cursor-pointer rounded-t-xl bg-white"
          />
        </div>

        <figcaption className="p-5 flex flex-col grow space-y-4 justify-between">
          <div className="flex flex-col space-y-2">
            <div>
              <h2 className="font-bold">{perk.name}</h2>
            </div>

            <span className="line-clamp-3 text-gray-400">{perk.description}</span>

            <span className="font-bold">
              <span className="text-green-500">{perk.price} points</span>
            </span>
          </div>
        </figcaption>
      </figure>

      <Dialog open={purchaseIsOpen} onOpenChange={setPurchaseIsOpen}>
        <DialogContent className="sm:max-w-[900px]">
          <PerkPurchaseFormModal
            perk={perk}
            balance={balance}
            close={() => setPurchaseIsOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

export default PerkCard