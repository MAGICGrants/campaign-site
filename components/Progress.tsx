import { formatUsd } from '../utils/money-formating'

type ProgressProps = { current: number; goal: number; percentOnly?: boolean }

const numberFormat = Intl.NumberFormat('en', { notation: 'compact', compactDisplay: 'short' })

const Progress = ({ current, goal, percentOnly }: ProgressProps) => {
  const percent = Math.floor((current / goal) * 100)

  return (
    <div className="w-full flex flex-col items-center space-y-1">
      <div className="w-full h-4 bg-primary/15 rounded-full overflow-hidden">
        <div
          className="bg-green-500 h-4 rounded-full text-xs"
          style={{ width: `${percent < 100 ? percent : 100}%` }}
        />
      </div>

      <span className="text-sm">
        Raised <strong>{percent < 100 ? percent : 100}%</strong>{' '}
        {!percentOnly && (
          <>
            of <strong className="text-green-500">${numberFormat.format(goal)}</strong> Goal
          </>
        )}
      </span>
    </div>
  )
}

export default Progress
