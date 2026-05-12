import { X, RefreshCw, RotateCcw } from 'lucide-react'

export default function ErrorCard({ message, onRetry, onReset }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-rose-500/8 border border-rose-500/25 text-rose-400 text-sm animate-fade-in">
      <X size={14} className="mt-0.5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 text-rose-400/70 hover:text-rose-400 transition-colors"
        >
          <RefreshCw size={12} /> Try again
        </button>
      )}
      {onReset && (
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-rose-400/70 hover:text-rose-400 transition-colors"
        >
          <RotateCcw size={12} /> Start over
        </button>
      )}
    </div>
  )
}
