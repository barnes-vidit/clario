import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, Timer, Volume2, Clock, Zap } from 'lucide-react'

const DIMENSIONS = [
  {
    key: 'pacing',
    label: 'Pacing',
    Icon: Timer,
    description: 'Words per minute vs. target',
  },
  {
    key: 'filler_words',
    label: 'Filler Words',
    Icon: Volume2,
    description: 'Minimising um, uh, like…',
  },
  {
    key: 'pauses',
    label: 'Pauses',
    Icon: Clock,
    description: 'Deliberate pause placement',
  },
  {
    key: 'hero_word_emphasis',
    label: 'Emphasis',
    Icon: Zap,
    description: 'Stress on key words',
  },
]

function AnimatedBar({ score, threshold, delay = 0 }) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.max(0, Math.min(100, score))), delay)
    return () => clearTimeout(t)
  }, [score, delay])

  const pct = Math.max(0, Math.min(100, score))
  const thresholdPct = threshold != null ? Math.max(0, Math.min(100, threshold)) : null

  let fillColor
  if (threshold == null) {
    fillColor = '#4A5C78'
  } else if (score >= threshold) {
    fillColor = 'linear-gradient(90deg, #059669, #10B981)'
  } else if (score >= threshold - 15) {
    fillColor = 'linear-gradient(90deg, #D97706, #F59E0B)'
  } else {
    fillColor = 'linear-gradient(90deg, #DC2626, #EF4444)'
  }

  return (
    <div className="metric-bar-track">
      <div
        className="metric-bar-fill"
        style={{
          width: `${width}%`,
          background: fillColor,
          transition: `width 0.75s cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`,
        }}
      />
      {thresholdPct != null && (
        <div
          className="absolute top-0 bottom-0 w-[1.5px] bg-stage-300/50 rounded-full"
          style={{ left: `${thresholdPct}%` }}
        />
      )}
    </div>
  )
}

function StatusBanner({ passed, autoAdvanced, retryNum }) {
  if (autoAdvanced) {
    return (
      <div className="verdict-auto">
        <AlertCircle size={18} className="text-stage-400 flex-shrink-0" />
        <span className="text-stage-200 font-normal text-sm">We'll come back to this one. Moving on for now.</span>
      </div>
    )
  }
  if (passed) {
    return (
      <div className="verdict-pass">
        <CheckCircle2 size={20} className="flex-shrink-0" />
        <span className="text-lg">Passed</span>
      </div>
    )
  }
  return (
    <div className="verdict-fail">
      <div className="flex items-center gap-2.5">
        <XCircle size={18} className="flex-shrink-0" />
        <span className="text-sm font-semibold">Needs work — try again</span>
      </div>
      {retryNum > 0 && (
        <span className="text-xs text-amber-500/70 font-mono">Attempt {retryNum + 1} of 3</span>
      )}
    </div>
  )
}

export default function ScoreCard({ scores, thresholds, passed, autoAdvanced, retryNum = 0 }) {
  if (!scores) return null

  return (
    <div className="space-y-5 animate-fade-up">
      <StatusBanner passed={passed} autoAdvanced={autoAdvanced} retryNum={retryNum} />

      <div>
        {DIMENSIONS.map((dim, i) => {
          const score = scores[dim.key]
          const threshold = thresholds?.[dim.key]
          if (score == null) return null

          const isUngraded = threshold == null
          let numColor
          if (isUngraded) {
            numColor = '#4A5C78'
          } else if (score >= threshold) {
            numColor = '#10B981'
          } else if (score >= threshold - 15) {
            numColor = '#F0A500'
          } else {
            numColor = '#EF4444'
          }

          return (
            <div
              key={dim.key}
              className={`metric-row ${isUngraded ? 'opacity-40' : ''}`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              {/* Icon — colored by pass/fail */}
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                isUngraded ? 'bg-stage-700 text-stage-400' :
                score >= threshold ? 'bg-emerald-500/15 text-emerald-400' :
                score >= threshold - 15 ? 'bg-amber-500/15 text-amber-400' :
                'bg-red-500/10 text-red-400'
              }`}>
                <dim.Icon size={13} />
              </div>

              {/* Label + description + bar */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-stage-100 tracking-wide leading-none">{dim.label}</p>
                    <p className="text-[10px] text-stage-500 mt-0.5 leading-none">{dim.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                    {threshold != null && (
                      <span className="text-[10px] text-stage-400 font-mono">need {threshold}</span>
                    )}
                    {isUngraded && (
                      <span className="text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5
                                       rounded-full bg-stage-700 text-stage-400 border border-stage-600">
                        ungraded
                      </span>
                    )}
                  </div>
                </div>
                <AnimatedBar score={score} threshold={threshold} delay={i * 80} />
              </div>

              {/* Score number */}
              <span className="metric-num flex-shrink-0" style={{ color: numColor }}>
                {score}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
