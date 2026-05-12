import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  ArrowLeft, TrendingUp, TrendingDown, Minus, CheckCircle2,
  AlertTriangle, RotateCcw, MessageSquare,
} from 'lucide-react'
import RecordButton from './RecordButton'

const API = import.meta.env.VITE_BACKEND_URL

function renderSentenceWithHighlights(sentence) {
  if (!sentence.hero_words?.length) return sentence.text
  const words = sentence.text.split(' ')
  const heroSet = new Set(sentence.hero_words)
  const pauseMap = {}
  for (const pm of (sentence.pause_markers || [])) {
    pauseMap[pm.after_word_index] = true
  }
  return words.map((word, i) => (
    <span key={i}>
      <span className={heroSet.has(i) ? 'text-amber-400 font-semibold' : undefined}>{word}</span>
      {pauseMap[i] && <span className="text-amber-500/40 mx-0.5 text-sm">·|·</span>}
      {i < words.length - 1 && ' '}
    </span>
  ))
}

const MAX_RECORD_MS = 5 * 60 * 1000 // 5 minutes

const DIMS = [
  { key: 'pacing',             label: 'Pacing',       color: '#F0A500' },
  { key: 'filler_words',       label: 'Fillers',      color: '#8B5CF6' },
  { key: 'pauses',             label: 'Pauses',       color: '#22D3EE' },
  { key: 'hero_word_emphasis', label: 'Emphasis',     color: '#10B981' },
  { key: 'pacing_consistency', label: 'Consistency',  color: '#F97316' },
  { key: 'coverage',           label: 'Coverage',     color: '#06B6D4' },
]

const ANALYSIS_STEPS = [
  'Uploading audio…',
  'Transcribing speech…',
  'Aligning sentences…',
  'Generating feedback…',
]

// Approximate step durations so the carousel feels realistic
const STEP_DELAYS_MS = [800, 4000, 3000, 99999]

function scoreColor(val) {
  if (val == null) return '#4A5C78'
  if (val >= 80) return '#10B981'
  if (val >= 60) return '#F0A500'
  return '#EF4444'
}

function ArcBadge({ arc }) {
  const map = {
    improving: { Icon: TrendingUp,   label: 'Improving',  cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
    declining:  { Icon: TrendingDown, label: 'Declining',  cls: 'text-rose-400    bg-rose-500/10    border-rose-500/25'    },
    stable:     { Icon: Minus,        label: 'Stable',     cls: 'text-sky-400     bg-sky-500/10     border-sky-500/25'     },
  }
  const { Icon, label, cls } = map[arc] ?? map.stable
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${cls}`}>
      <Icon size={11} />
      {label}
    </span>
  )
}

export default function FullScriptView() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [sentences, setSentences]         = useState([])
  const [skillLevel, setSkillLevel]       = useState('')
  const [loadingSession, setLoadingSession] = useState(true)

  const [phase, setPhase]   = useState('ready') // ready | analysing | results | error
  const [analysisStep, setAnalysisStep] = useState(0)
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const stepTimerRef = useRef(null)

  // Load session
  useEffect(() => {
    axios.get(`${API}/api/session/${sessionId}`)
      .then(({ data }) => {
        setSentences(data.sentences || [])
        setSkillLevel(data.skill_level || '')
      })
      .catch(() => navigate('/'))
      .finally(() => setLoadingSession(false))
  }, [sessionId, navigate])

  // Advance analysis step carousel while analysing
  useEffect(() => {
    if (phase !== 'analysing') {
      clearTimeout(stepTimerRef.current)
      return
    }
    setAnalysisStep(0)

    let step = 0
    const advance = () => {
      step += 1
      if (step < ANALYSIS_STEPS.length - 1) {
        setAnalysisStep(step)
        stepTimerRef.current = setTimeout(advance, STEP_DELAYS_MS[step])
      } else {
        setAnalysisStep(ANALYSIS_STEPS.length - 1)
      }
    }
    stepTimerRef.current = setTimeout(advance, STEP_DELAYS_MS[0])
    return () => clearTimeout(stepTimerRef.current)
  }, [phase])

  const submit = useCallback(async (blob, mimeType) => {
    setPhase('analysing')
    const form = new FormData()
    form.append('audio', blob, `recording.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`)

    try {
      const { data } = await axios.post(
        `${API}/api/session/${sessionId}/fullscript`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300_000 },
      )
      setResult(data)
      setPhase('results')
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Analysis failed — please try again.'
      setErrorMsg(detail)
      setPhase('error')
    }
  }, [sessionId])

  const handleRecordingComplete = useCallback((blob, mimeType) => {
    submit(blob, mimeType)
  }, [submit])

  const handleRetry = () => {
    setResult(null)
    setErrorMsg(null)
    setPhase('ready')
  }

  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-stage-500 border-t-indigo-400 animate-spin" />
      </div>
    )
  }

  // ── RESULTS ──────────────────────────────────────────────────────────
  if (phase === 'results' && result) {
    const { overall, sentence_scores, coaching_text, total_fillers, total_words, total_duration_s } = result
    const mins = Math.floor(total_duration_s / 60)
    const secs = Math.round(total_duration_s % 60)
    const durationLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

    return (
      <div className="min-h-screen px-5 py-10 animate-fade-up">
        <div className="max-w-4xl mx-auto space-y-10">

          {/* Hero */}
          <div className="text-center space-y-4 py-2">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full
                            bg-indigo-500/10 border border-indigo-500/25
                            text-xs font-medium text-indigo-400">
              <CheckCircle2 size={11} />
              Full Script Run Complete
            </div>
            <h1 className="font-display text-[3rem] font-normal text-white leading-none tracking-tight">
              Full Run Done.
            </h1>
            <p className="text-stage-300 text-sm">
              {sentences.length} sentences · {skillLevel} level · {durationLabel} · {total_words} words
            </p>
            <div className="pt-1">
              <ArcBadge arc={overall.arc} />
            </div>
          </div>

          {/* Coaching text */}
          <div className="card p-6 space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-indigo-400" />
              <p className="label">Clario's Take</p>
            </div>
            <p className="text-stage-100 text-sm leading-relaxed">{coaching_text}</p>
            <p className="text-stage-500 text-xs">
              {total_fillers} filler word{total_fillers !== 1 ? 's' : ''} detected across {total_words} words
            </p>
          </div>

          {/* Score tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {DIMS.map(dim => {
              const val = overall[dim.key]
              return (
                <div
                  key={dim.key}
                  className="card p-5 text-center space-y-2"
                  style={{ boxShadow: val != null ? `0 0 20px ${dim.color}0D` : undefined }}
                >
                  <p
                    className="font-display text-[2.25rem] font-bold tabular-nums leading-none"
                    style={{ color: val != null ? dim.color : '#4A5C78' }}
                  >
                    {val ?? '—'}
                  </p>
                  <p className="text-[11px] text-stage-300 font-medium uppercase tracking-wider">
                    {dim.label}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Per-sentence breakdown */}
          <div className="space-y-4">
            <p className="label px-1">Sentence Breakdown</p>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stage-700/60">
                    <th className="text-left text-[11px] text-stage-400 font-medium uppercase tracking-wider px-4 py-3 w-8">#</th>
                    <th className="text-left text-[11px] text-stage-400 font-medium uppercase tracking-wider px-4 py-3">Sentence</th>
                    <th className="text-center text-[11px] text-stage-400 font-medium uppercase tracking-wider px-3 py-3 hidden md:table-cell">Pacing</th>
                    <th className="text-center text-[11px] text-stage-400 font-medium uppercase tracking-wider px-3 py-3 hidden md:table-cell">Pauses</th>
                    <th className="text-center text-[11px] text-stage-400 font-medium uppercase tracking-wider px-3 py-3 hidden md:table-cell">Emphasis</th>
                    <th className="text-center text-[11px] text-stage-400 font-medium uppercase tracking-wider px-3 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {sentences.map((s, i) => {
                    const sc = sentence_scores[i]
                    if (!sc) return null
                    return (
                      <tr
                        key={s.sentence_id}
                        className="border-b border-stage-700/30 last:border-0 hover:bg-stage-800/30 transition-colors"
                      >
                        <td className="px-4 py-3 text-stage-500 font-mono text-xs">{i + 1}</td>
                        <td className="px-4 py-3 text-stage-200 max-w-xs">
                          <span className="line-clamp-1">{s.text}</span>
                        </td>
                        <td className="px-3 py-3 text-center font-mono hidden md:table-cell">
                          <span style={{ color: scoreColor(sc.pacing) }}>{sc.pacing}</span>
                        </td>
                        <td className="px-3 py-3 text-center font-mono hidden md:table-cell">
                          <span style={{ color: scoreColor(sc.pauses) }}>{sc.pauses}</span>
                        </td>
                        <td className="px-3 py-3 text-center font-mono hidden md:table-cell">
                          <span style={{ color: scoreColor(sc.hero_word_emphasis) }}>{sc.hero_word_emphasis}</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {sc.covered
                            ? <CheckCircle2 size={13} className="text-emerald-400 mx-auto" />
                            : <AlertTriangle size={13} className="text-amber-400 mx-auto" />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-stage-500 px-1">
              <CheckCircle2 size={11} className="inline mr-1 text-emerald-400" />covered &nbsp;·&nbsp;
              <AlertTriangle size={11} className="inline mr-1 text-amber-400" />low coverage detected
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-4 pb-12">
            <button onClick={() => navigate(`/report/${sessionId}`)} className="btn-ghost flex-1">
              <ArrowLeft size={13} /> Back to Report
            </button>
            <button onClick={handleRetry} className="btn-ghost flex-1">
              <RotateCcw size={13} /> Try Again
            </button>
          </div>

        </div>
      </div>
    )
  }

  // ── ERROR ─────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-5">
        <div className="card p-6 max-w-md w-full space-y-3 text-center">
          <AlertTriangle size={28} className="text-amber-400 mx-auto" />
          <p className="text-stage-100 text-sm">{errorMsg}</p>
        </div>
        <div className="flex gap-4">
          <button onClick={() => navigate(`/report/${sessionId}`)} className="btn-ghost">
            <ArrowLeft size={13} /> Back to Report
          </button>
          <button onClick={handleRetry} className="btn-ghost">
            <RotateCcw size={13} /> Try Again
          </button>
        </div>
      </div>
    )
  }

  // ── ANALYSING ────────────────────────────────────────────────────────
  if (phase === 'analysing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8 px-5">
        <div className="space-y-3 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-stage-500 border-t-indigo-400 animate-spin mx-auto" />
          <p className="text-stage-100 text-sm font-medium">{ANALYSIS_STEPS[analysisStep]}</p>
          <div className="flex gap-1.5 justify-center">
            {ANALYSIS_STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  i <= analysisStep ? 'bg-indigo-400' : 'bg-stage-600'
                }`}
              />
            ))}
          </div>
        </div>
        <p className="text-stage-400 text-xs max-w-xs text-center">
          Analysing your full-script delivery — this takes a moment for longer recordings.
        </p>
      </div>
    )
  }

  // ── READY ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/report/${sessionId}`)}
            className="btn-ghost px-3 py-2"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h1 className="text-white font-display text-2xl font-normal tracking-tight">Full Script Run</h1>
            <p className="text-stage-400 text-sm mt-0.5">
              Deliver the entire script in one continuous take
            </p>
          </div>
        </div>

        {/* Instructions */}
        <div className="card p-5 space-y-2">
          <p className="text-stage-200 text-sm leading-relaxed">
            No demos. No retries mid-script. Read through all {sentences.length} sentences as if you're delivering the real thing.
            When you're ready, tap record and go.
          </p>
          <p className="text-stage-500 text-xs">Max recording time: 5 minutes</p>
        </div>

        {/* Script text */}
        <div className="card p-5 space-y-3 max-h-72 overflow-y-auto">
          <p className="label">Your Script</p>
          <div className="space-y-3">
            {sentences.map((s, i) => (
              <p key={s.sentence_id} className="text-stage-200 text-sm leading-relaxed">
                <span className="text-stage-600 font-mono text-xs mr-2 select-none">{i + 1}.</span>
                {renderSentenceWithHighlights(s)}
              </p>
            ))}
          </div>
        </div>

        {/* Record */}
        <div className="flex flex-col items-center gap-4 py-6">
          <RecordButton
            onRecordingComplete={handleRecordingComplete}
            maxDurationMs={MAX_RECORD_MS}
          />
          <p className="text-stage-500 text-xs text-center max-w-xs">
            Tap to start · speak all the way through · tap again to finish
          </p>
        </div>

      </div>
    </div>
  )
}
