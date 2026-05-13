import { Lightbulb, ChevronLeft, ChevronRight, X } from 'lucide-react'

export default function RecordingTip({ tip, tipIndex, totalTips, onDismiss, onPrev, onNext }) {
  return (
    <div className="absolute bottom-6 right-6 w-[280px] animate-fade-up" style={{ zIndex: 10 }}>
      <div
        style={{
          background: 'rgba(10, 15, 28, 0.88)',
          border: '1px solid rgba(36, 48, 78, 0.75)',
          borderRadius: '0.875rem',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(240,165,0,0.06)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <div className="flex items-center gap-1.5">
            <Lightbulb size={12} className="text-amber-400" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-amber-400/80">
              Tip
            </span>
          </div>
          <button
            onClick={onDismiss}
            className="text-stage-500 hover:text-stage-300 transition-colors"
            aria-label="Dismiss tip"
          >
            <X size={13} />
          </button>
        </div>

        {/* Tip text — key triggers re-animation on tip change */}
        <p
          key={tip.id}
          className="px-4 pb-3 text-[0.8125rem] text-stage-200 leading-relaxed animate-fade-up"
        >
          {tip.text}
        </p>

        {/* Footer — dots + nav arrows */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-stage-700/50">
          <button
            onClick={onPrev}
            className="text-stage-500 hover:text-stage-300 transition-colors p-0.5"
            aria-label="Previous tip"
          >
            <ChevronLeft size={14} />
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalTips }).map((_, i) => (
              <span
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i === tipIndex
                    ? 'w-3 h-1.5 bg-amber-400/70'
                    : 'w-1.5 h-1.5 bg-stage-600'
                }`}
              />
            ))}
          </div>

          <button
            onClick={onNext}
            className="text-stage-500 hover:text-stage-300 transition-colors p-0.5"
            aria-label="Next tip"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
