import { CheckIcon, ChevronsUpDown, ChevronsUpDownIcon } from 'lucide-react'
import { MONTHLY_MEMBERSHIP_MIN_PRICE_USD, ANNUALLY_MEMBERSHIP_MIN_PRICE_USD } from '../config'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Button } from './ui/button'
import { useState } from 'react'
import { useMediaQuery } from '../utils/use-media-query'
import { useFundSlug } from '../utils/use-fund-slug'

function MembershipPerksAside() {
  const [isExpanded, setIsExpanded] = useState(false)
  const shouldBeExpanded = useMediaQuery('(min-width: 640px)')
  const fundSlug = useFundSlug()

  if (fundSlug === 'monero')
    return (
      <div className="max-w-[540px] sm:min-w-60 sm:max-w-80 p-6 flex flex-col space-y-4 bg-white rounded-lg text-sm">
        <h4 className="font-bold text-lg">Get a Membership</h4>

        <p>
          For ${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}/month or ${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}
          /year, you support our charitable mission.
        </p>
      </div>
    )

  if (fundSlug === 'firo')
    return (
      <div className="max-w-[540px] sm:min-w-60 sm:max-w-80 p-6 flex flex-col space-y-4 bg-white rounded-lg text-sm">
        <h4 className="font-bold text-lg">Get a Membership</h4>

        <p>
          For ${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}/month or ${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}
          /year, you support our charitable mission.
        </p>
      </div>
    )

  if (fundSlug === 'privacyguides')
    return (
      <div className="max-w-[540px] sm:min-w-60 sm:max-w-80 p-6 flex flex-col space-y-4 bg-white rounded-lg text-sm">
        <h4 className="font-bold text-lg">Membership Perks</h4>

        <p>
          For ${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}/month or ${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}
          /year, you support our charitable mission and receive these special perks as a thank you:
        </p>

        <Collapsible
          open={isExpanded || shouldBeExpanded}
          onOpenChange={setIsExpanded}
          className="flex flex-col space-y-4"
        >
          <CollapsibleContent className="flex flex-col space-y-4">
            <div className="flex flex-row space-x-2 items-start">
              <div className="text-md">
                <CheckIcon className="text-teal-500" />
              </div>
              <p>Show your support with a special Member flair on the Privacy Guides forum.</p>
            </div>

            <div className="flex flex-row space-x-2 items-start">
              <div className="text-md">
                <CheckIcon className="text-teal-500" />
              </div>
              <p>Get recognized with your name (or pseudonym) included in Privacy Guides videos.</p>
            </div>

            <div className="flex flex-row space-x-2 items-start">
              <div className="text-md">
                <CheckIcon className="text-teal-500" />
              </div>
              <p>
                Optionally receive points back, redeemable for Privacy Guides merchandise and
                various other perks.
              </p>
            </div>
          </CollapsibleContent>
          {!shouldBeExpanded && (
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="light">
                <ChevronsUpDownIcon />
                {isExpanded ? 'Collapse' : 'Expand'}
              </Button>
            </CollapsibleTrigger>
          )}
        </Collapsible>
      </div>
    )

  if (fundSlug === 'general')
    return (
      <div className="max-w-[540px] sm:min-w-60 sm:max-w-80 p-6 flex flex-col space-y-4 bg-white rounded-lg text-sm">
        <h4 className="font-bold text-lg">Get a Membership</h4>

        <p>
          For ${MONTHLY_MEMBERSHIP_MIN_PRICE_USD}/month or ${ANNUALLY_MEMBERSHIP_MIN_PRICE_USD}
          /year, you support our charitable mission.
        </p>
      </div>
    )

  return <></>
}

export default MembershipPerksAside
