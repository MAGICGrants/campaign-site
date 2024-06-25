import { faMonero } from '@fortawesome/free-brands-svg-icons'
import { faCreditCard } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useRef, useState } from 'react'
import { MAX_AMOUNT } from '../config'
import { fetchPostJSON } from '../utils/api-helpers'
import Spinner from './Spinner'
import { trpc } from '../utils/trpc'
import { useToast } from './ui/use-toast'
import { useSession } from 'next-auth/react'
import { Button } from './ui/button'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import { Label } from './ui/label'

type DonationStepsProps = {
  projectNamePretty: string
  projectSlug: string
}
const DonationSteps: React.FC<DonationStepsProps> = ({
  projectNamePretty,
  projectSlug,
}) => {
  const { toast } = useToast()
  const session = useSession()
  console.log(session.status)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const [deductible, setDeductible] = useState('no')
  const [amount, setAmount] = useState('')

  const [readyToPay, setReadyToPay] = useState(false)

  const [btcPayLoading, setBtcpayLoading] = useState(false)
  const [fiatLoading, setFiatLoading] = useState(false)

  const donateWithFiatMutation = trpc.donation.donateWithFiat.useMutation()
  const donateWithCryptoMutation = trpc.donation.donateWithCrypto.useMutation()

  const formRef = useRef<HTMLFormElement | null>(null)

  const radioHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDeductible(event.target.value)
  }

  function handleFiatAmountClick(e: React.MouseEvent, value: string) {
    e.preventDefault()
    setAmount(value)
  }

  useEffect(() => {
    if (amount && typeof parseInt(amount) === 'number') {
      if (deductible === 'no' || (name && email)) {
        setReadyToPay(true)
      } else {
        setReadyToPay(false)
      }
    } else {
      setReadyToPay(false)
    }
  }, [deductible, amount, email, name])

  async function handleBtcPay() {
    const validity = formRef.current?.checkValidity()
    if (!validity) {
      return
    }

    try {
      const result = await donateWithCryptoMutation.mutateAsync({
        email: email || null,
        name: name || null,
        amount: Number(amount),
        projectSlug,
        projectName: projectNamePretty,
      })

      window.location.assign(result.url)
    } catch (e) {
      toast({
        title: 'Sorry, something went wrong.',
        variant: 'destructive',
      })
    }
  }

  async function handleFiat() {
    const validity = formRef.current?.checkValidity()

    if (!validity) {
      return
    }

    try {
      const result = await donateWithFiatMutation.mutateAsync({
        email: email || null,
        name: name || null,
        amount: parseInt(amount),
        projectSlug,
        projectName: projectNamePretty,
      })

      if (!result.url) throw Error()

      window.location.assign(result.url)
    } catch (e) {
      toast({
        title: 'Sorry, something went wrong.',
        variant: 'destructive',
      })
    }
  }

  return (
    <form
      ref={formRef}
      className="mt-4 flex flex-col gap-4"
      onSubmit={(e) => e.preventDefault()}
    >
      <section className="flex flex-col gap-1">
        <h3>Do you want this donation to be tax deductible (USA only)?</h3>
        <div className="flex space-x-4 ">
          <label>
            <input
              type="radio"
              id="no"
              name="deductible"
              value="no"
              onChange={radioHandler}
              defaultChecked={true}
            />
            No
          </label>
          <label>
            <input
              type="radio"
              id="yes"
              value="yes"
              name="deductible"
              onChange={radioHandler}
            />
            Yes
          </label>
        </div>

        {session.status !== 'authenticated' && (
          <>
            <h3>
              Name{' '}
              <span className="text-subtle">
                {deductible === 'yes' ? '(required)' : '(optional)'}
              </span>
            </h3>
            <input
              type="text"
              placeholder={'MAGIC Monero Fund'}
              required={deductible === 'yes'}
              onChange={(e) => setName(e.target.value)}
              className="mb-4"
            ></input>

            <h3>
              Email{' '}
              <span className="text-subtle">
                {deductible === 'yes' ? '(required)' : '(optional)'}
              </span>
            </h3>
            <input
              type="email"
              placeholder={`MoneroFund@MagicGrants.org`}
              required={deductible === 'yes'}
              onChange={(e) => setEmail(e.target.value)}
            ></input>
          </>
        )}
      </section>

      <section>
        <div className="flex justify-between items-center">
          <h3>How much would you like to donate?</h3>
        </div>
        <div className="sm:flex-row flex flex-col gap-2 py-2" role="group">
          {[50, 100, 250, 500].map((value, index) => (
            <button
              key={index}
              className="group"
              onClick={(e) => handleFiatAmountClick(e, value.toString())}
            >
              ${value}
            </button>
          ))}
          <div className="relative flex w-full">
            <div className="flex absolute inset-y-0 left-0 items-center pl-3 pointer-events-none">
              {/* <FontAwesomeIcon icon={faDollarSign} className="w-5 h-5 text-black" /> */}
              <span className="w-5 h-5 font-mono text-xl mb-2">{'$'}</span>
            </div>
            <input
              required
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
              }}
              className="!pl-10 w-full"
              placeholder="Or enter custom amount"
            />
          </div>
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleBtcPay} disabled={!readyToPay || btcPayLoading}>
          {btcPayLoading ? (
            <Spinner />
          ) : (
            <FontAwesomeIcon icon={faMonero} className="h-5 w-5" />
          )}
          Donate with Monero
        </Button>

        <Button
          onClick={handleFiat}
          disabled={!readyToPay || donateWithFiatMutation.isPending}
          className="bg-indigo-500 hover:bg-indigo-700"
        >
          {donateWithFiatMutation.isPending ? (
            <Spinner />
          ) : (
            <FontAwesomeIcon icon={faCreditCard} className="h-5 w-5" />
          )}
          Donate with fiat
        </Button>
      </div>
    </form>
  )
}

export default DonationSteps
