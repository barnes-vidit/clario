import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { Mic, Upload, FileText, BookOpen, Zap, ChevronRight, X, Loader2, Volume2, TrendingUp } from 'lucide-react'

const API = import.meta.env.VITE_BACKEND_URL

const SKILL_LEVELS = [
  {
    id: 'beginner',
    label: 'Beginner',
    tagline: 'First time? No pressure.',
    description: 'Relaxed thresholds, maximum encouragement. We\'ll ease you into it.',
    Icon: BookOpen,
    accent: 'emerald',
    accentHex: '#10B981',
    activeBg: 'bg-emerald-500/8',
    activeBorder: 'border-emerald-500/50',
    activeGlow: 'shadow-[0_0_20px_rgba(16,185,129,0.12)]',
    activeIcon: 'bg-emerald-500/20 text-emerald-400',
    activeDot: 'bg-emerald-400',
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    tagline: 'Sharpen the edges.',
    description: 'You know the basics. Tighter standards and specific, honest feedback.',
    Icon: Mic,
    accent: 'amber',
    accentHex: '#F0A500',
    activeBg: 'bg-amber-500/8',
    activeBorder: 'border-amber-500/50',
    activeGlow: 'shadow-[0_0_20px_rgba(240,165,0,0.12)]',
    activeIcon: 'bg-amber-500/20 text-amber-400',
    activeDot: 'bg-amber-400',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    tagline: 'High stakes only.',
    description: 'Professional-grade precision. For presentations where the room is watching.',
    Icon: Zap,
    accent: 'violet',
    accentHex: '#8B5CF6',
    activeBg: 'bg-violet-500/8',
    activeBorder: 'border-violet-500/50',
    activeGlow: 'shadow-[0_0_20px_rgba(139,92,246,0.12)]',
    activeIcon: 'bg-violet-500/20 text-violet-400',
    activeDot: 'bg-violet-400',
  },
]

const WAVE_HEIGHTS = [
  28, 52, 38, 75, 32, 88, 58, 70, 42, 84, 52, 65, 38, 94, 48, 78,
  35, 82, 62, 68, 45, 76, 40, 60, 52, 80, 33, 72,
]

const ACCEPTED = ['.txt', '.docx', '.pdf']
const MAX_SIZE_MB = 5

function FileDropzone({ file, onFile, onClear, dragActive, onDragEnter, onDragLeave, onDrop }) {
  const inputRef = useRef(null)

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={e => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => !file && inputRef.current?.click()}
      className={`
        relative flex flex-col items-center justify-center gap-3
        min-h-[160px] rounded-xl border-2 border-dashed
        transition-all duration-300 cursor-pointer select-none
        ${file
          ? 'border-amber-500/40 bg-amber-500/4 cursor-default'
          : dragActive
            ? 'border-amber-400/80 bg-amber-500/8 scale-[1.01]'
            : 'border-stage-500/60 bg-stage-800/30 hover:border-stage-400 hover:bg-stage-700/30'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED.join(',')}
        onChange={e => onFile(e.target.files[0])}
      />

      {file ? (
        <>
          <div className="flex items-center gap-3 px-4">
            <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <FileText size={17} className="text-amber-400" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-white truncate max-w-[220px]">{file.name}</p>
              <p className="text-xs text-stage-300 mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onClear() }}
            className="absolute top-2.5 right-2.5 w-6 h-6 rounded-md bg-stage-600 hover:bg-stage-500
                       flex items-center justify-center transition-colors"
          >
            <X size={11} className="text-stage-200" />
          </button>
        </>
      ) : (
        <>
          <div className={`
            w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300
            ${dragActive ? 'bg-amber-500/20 scale-110' : 'bg-stage-700'}
          `}>
            <Upload size={19} className={dragActive ? 'text-amber-400' : 'text-stage-300'} />
          </div>
          <div className="text-center px-6">
            <p className="text-sm font-medium text-stage-100">
              Drop your script here, or{' '}
              <span className="text-amber-400 hover:text-amber-300 transition-colors">browse</span>
            </p>
            <p className="text-xs text-stage-400 mt-1">TXT · DOCX · PDF &nbsp;·&nbsp; Max 5 MB</p>
          </div>
        </>
      )}
    </div>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()

  const [file, setFile] = useState(null)
  const [skillLevel, setSkillLevel] = useState('intermediate')
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = useCallback((f) => {
    if (!f) return
    const ext = f.name.split('.').pop().toLowerCase()
    if (!['txt', 'docx', 'pdf'].includes(ext)) {
      setError('Unsupported file type. Please upload a TXT, DOCX, or PDF.')
      return
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File is too large. Maximum size is ${MAX_SIZE_MB} MB.`)
      return
    }
    setError(null)
    setFile(f)
  }, [])

  const handleDragEnter = useCallback((e) => { e.preventDefault(); setDragActive(true) }, [])
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setDragActive(false) }, [])
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0])
  }, [handleFile])

  const handleSubmit = async () => {
    if (!file) { setError('Please upload your script first.'); return }
    setError(null)
    setLoading(true)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('skill_level', skillLevel)

      const { data } = await axios.post(`${API}/api/upload`, form, { timeout: 300_000 })
      navigate(`/review/${data.session_id}`, {
        state: { annotation: data.annotation, paragraphs: data.paragraphs, skill_level: data.skill_level },
      })
    } catch (err) {
      const detail = err.code === 'ECONNABORTED'
        ? 'Timed out — your script may be too long. Try a shorter file.'
        : err.response?.data?.detail || 'Something went wrong. Please try again.'
      setError(detail)
    } finally {
      setLoading(false)
    }
  }

  const activeLevel = SKILL_LEVELS.find(s => s.id === skillLevel)

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel: brand stage ───────────────────────────────── */}
      <div className="hidden lg:flex flex-col w-[52%] px-14 py-14 relative overflow-hidden bg-stage-900">

        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 w-[600px] h-[500px] bg-gradient-radial from-indigo-500/6 to-transparent rounded-full -translate-x-1/4 -translate-y-1/4" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[400px] bg-gradient-radial from-amber-500/5 to-transparent rounded-full translate-x-1/4 translate-y-1/4" />
        </div>

        {/* Center block: logo + headline + value props */}
        <div className="flex-1 flex flex-col justify-center relative z-10 space-y-10">
          <p className="font-display italic text-white/70 text-xl tracking-tight">Clario</p>

          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="font-display text-[3.25rem] font-normal text-white leading-[1.08] tracking-tight">
                From script<br />
                to stage-ready.
              </h1>
              <p className="text-stage-200 text-[1.0625rem] leading-[1.7] max-w-[380px]">
                Practice every sentence with a live AI coach before you walk on stage. Last-minute prep that actually works.
              </p>
            </div>

            {/* Value props with icons */}
            <div className="space-y-3.5">
              {[
                { Icon: Mic,        text: 'Sentence-by-sentence coaching, live' },
                { Icon: Volume2,    text: 'Hear the ideal delivery before you attempt it' },
                { Icon: TrendingUp, text: 'Pace, pauses, and emphasis — all measured' },
              ].map(({ Icon, text }, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center">
                    <Icon size={12} className="text-amber-400/55" />
                  </div>
                  <p className="text-stage-200 text-sm">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom: ambient waveform */}
        <div className="relative z-10 space-y-4 flex-shrink-0">
          <div className="flex items-end gap-[3px] h-14" aria-hidden="true">
            {WAVE_HEIGHTS.map((h, i) => (
              <div
                key={i}
                className="flex-1 bg-amber-400 rounded-full origin-bottom animate-waveform"
                style={{
                  height: `${h}%`,
                  opacity: 0.25 + (h / 100) * 0.45,
                  animationDelay: `${i * 0.075}s`,
                  animationDuration: `${1.6 + (i % 5) * 0.2}s`,
                }}
              />
            ))}
          </div>
          <p className="text-stage-400 text-xs">
            Your script is never stored permanently — sessions are in-memory only.
          </p>
        </div>
      </div>

      {/* ── Right panel: form ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-12
                      bg-stage-900 lg:bg-stage-800/50 lg:border-l lg:border-stage-600/40 relative">

        {/* Mobile-only logo */}
        <div className="lg:hidden mb-6 text-center animate-fade-up">
          <p className="font-display italic text-white text-2xl tracking-tight mb-1">Clario</p>
          <p className="text-stage-300 text-sm">Last-minute prep. Done right.</p>
        </div>

        <div className="w-full max-w-[420px] space-y-8 animate-fade-up" style={{ animationDelay: '0.05s' }}>

          {/* Desktop form header */}
          <div className="hidden lg:block space-y-1">
            <p className="font-display text-white font-normal text-xl">Prepare your script</p>
            <p className="text-stage-300 text-sm mt-0.5">Upload your presentation and we'll build your practice session.</p>
          </div>

          {/* File upload */}
          <div className="space-y-2">
            <p className="label">Your Script</p>
            <FileDropzone
              file={file}
              onFile={handleFile}
              onClear={() => setFile(null)}
              dragActive={dragActive}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          </div>

          {/* Skill level */}
          <div className="space-y-2">
            <p className="label">Skill Level</p>
            <div className="grid grid-cols-3 gap-2">
              {SKILL_LEVELS.map((level) => {
                const { Icon } = level
                const isActive = skillLevel === level.id
                return (
                  <button
                    key={level.id}
                    onClick={() => setSkillLevel(level.id)}
                    className={`
                      relative flex flex-col items-center text-center gap-2.5 p-3.5
                      rounded-xl border transition-all duration-200
                      ${isActive
                        ? `${level.activeBg} ${level.activeBorder} ${level.activeGlow}`
                        : 'bg-stage-800/60 border-stage-600/60 hover:bg-stage-700/60 hover:border-stage-500'
                      }
                    `}
                  >
                    {/* Active indicator dot */}
                    {isActive && (
                      <span className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${level.activeDot}`} />
                    )}
                    <div className={`
                      w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200
                      ${isActive ? level.activeIcon : 'bg-stage-700 text-stage-300'}
                    `}>
                      <Icon size={15} />
                    </div>
                    <div>
                      <p className={`text-xs font-semibold ${isActive ? 'text-white' : 'text-stage-100'}`}>
                        {level.label}
                      </p>
                      <p className={`text-[10px] leading-tight mt-0.5 ${isActive ? 'text-stage-200' : 'text-stage-400'}`}>
                        {level.tagline}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Active level description */}
            <div className="px-4 py-3 rounded-lg bg-stage-800/40 border border-stage-600/30">
              <p className="text-xs text-stage-300 leading-relaxed">
                {activeLevel?.description}
              </p>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg
                            bg-rose-500/8 border border-rose-500/25 text-rose-400 text-sm animate-fade-in">
              <X size={13} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || !file}
            className={`
              w-full flex items-center justify-center gap-2.5 py-3.5 rounded-lg
              font-semibold text-sm transition-all duration-200
              ${loading || !file
                ? 'bg-amber-500/20 text-amber-300/50 cursor-not-allowed border border-amber-500/15'
                : 'btn-primary'
              }
            `}
          >
            {loading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Preparing your script — this takes 30–60 s…
              </>
            ) : (
              <>
                Prepare My Script
                <ChevronRight size={15} />
              </>
            )}
          </button>

          {/* Mobile privacy note */}
          <p className="lg:hidden text-xs text-stage-400 text-center">
            Your script is never stored permanently — sessions are in-memory only.
          </p>
        </div>
      </div>
    </div>
  )
}
