import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

const MIN_DURATION_MS = 1000
const MAX_DURATION_MS = 60000
const CIRCUMFERENCE = 2 * Math.PI * 46 // radius 46 on a 100x100 viewBox

function formatTime(ms) {
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

// States: 'idle' | 'recording' | 'processing'
const RecordButton = forwardRef(function RecordButton({ onRecordingComplete, onRecordingStart, disabled = false }, ref) {
  const [state, setState] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const autoStopRef = useRef(null)

  const clearTimers = () => {
    clearInterval(timerRef.current)
    clearTimeout(autoStopRef.current)
  }

  const stopRecording = useCallback(() => {
    clearTimers()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    setElapsed(0)
    chunksRef.current = []

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setError('Microphone access denied.')
      return
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                   : MediaRecorder.isTypeSupported('audio/ogg')  ? 'audio/ogg'
                   : ''

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      const duration = Date.now() - startTimeRef.current

      if (duration < MIN_DURATION_MS) {
        setState('idle')
        setError('Too short — try again.')
        return
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      setState('processing')
      onRecordingComplete(blob, recorder.mimeType || 'audio/webm')
    }

    recorder.start(100)
    setState('recording')
    startTimeRef.current = Date.now()
    onRecordingStart?.()

    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current)
    }, 200)

    autoStopRef.current = setTimeout(() => stopRecording(), MAX_DURATION_MS)
  }, [onRecordingComplete, stopRecording])

  useEffect(() => () => clearTimers(), [])

  useEffect(() => {
    if (disabled) {
      clearTimers()
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop()
      }
      setState(prev => prev === 'processing' ? 'processing' : 'idle')
    }
  }, [disabled])

  const handleClick = useCallback(() => {
    if (state === 'idle') startRecording()
    else if (state === 'recording') stopRecording()
  }, [state, startRecording, stopRecording])

  useImperativeHandle(ref, () => ({ trigger: handleClick }), [handleClick])

  const isRecording = state === 'recording'
  const isProcessing = state === 'processing'
  const isDisabled = disabled || isProcessing

  // SVG arc progress (depletes over MAX_DURATION_MS)
  const progressRatio = isRecording ? elapsed / MAX_DURATION_MS : 0
  const dashOffset = CIRCUMFERENCE * (1 - progressRatio)

  return (
    <div className="flex flex-col items-center gap-5">

      {/* Button + SVG arc wrapper */}
      <div className="relative" style={{ width: 108, height: 108 }}>

        {/* SVG time arc — only shown while recording */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          fill="none"
          style={{ opacity: isRecording ? 1 : 0, transition: 'opacity 0.4s ease' }}
        >
          {/* Track ring */}
          <circle
            cx="50" cy="50" r="46"
            stroke="rgba(239,68,68,0.12)"
            strokeWidth="1.5"
          />
          {/* Progress ring */}
          <circle
            cx="50" cy="50" r="46"
            stroke="#EF4444"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.25s linear' }}
          />
        </svg>

        {/* The button itself */}
        <button
          onClick={handleClick}
          disabled={isDisabled}
          className={`
            absolute top-[6px] left-[6px]
            w-24 h-24 rounded-full
            flex items-center justify-center
            transition-all duration-300 focus:outline-none
            ${isRecording
              ? 'bg-red-600 border-2 border-red-500 text-white shadow-glow-crimson animate-pulse-ring'
              : isProcessing
                ? 'bg-indigo-600/40 border-2 border-indigo-500/50 text-indigo-300 cursor-wait'
                : isDisabled
                  ? 'bg-stage-700/60 border-2 border-stage-600 cursor-not-allowed text-stage-500'
                  : 'bg-stage-700 border-2 border-stage-500 text-stage-200 hover:bg-stage-600 hover:border-stage-400 hover:text-stage-100 hover:shadow-[0_0_24px_rgba(255,255,255,0.04)] active:scale-95'
            }
          `}
          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        >
          {isProcessing ? (
            <Loader2 size={26} className="animate-spin" />
          ) : isRecording ? (
            <Square size={20} className="fill-white" />
          ) : (
            <Mic size={26} />
          )}
        </button>
      </div>

      {/* Status row */}
      <div className="flex flex-col items-center gap-1.5 min-h-[36px]">
        {isRecording ? (
          <>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-sm text-red-400 tabular-nums">{formatTime(elapsed)}</span>
            </div>
            <span className="text-[11px] text-stage-400">Tap to stop</span>
          </>
        ) : isProcessing ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce-dot" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce-dot" style={{ animationDelay: '160ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce-dot" style={{ animationDelay: '320ms' }} />
          </div>
        ) : (
          <span className="text-xs text-stage-400">
            {disabled ? 'Listen to the demo first' : 'Tap to record'}
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-400 text-center max-w-[180px] animate-fade-in">{error}</p>
      )}
    </div>
  )
})

export default RecordButton
