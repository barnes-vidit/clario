import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import axios from 'axios'
import { ChevronRight, RotateCcw, Loader2, Mic, FileText, Star, PauseCircle, Info } from 'lucide-react'

const API = import.meta.env.VITE_BACKEND_URL

function PauseMarkerIcon({ marker, removed, onRemove }) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  const typeStyles = {
    breath:     { color: 'text-sky-400 hover:text-sky-300',      bg: 'bg-sky-500/10 border-sky-500/20' },
    impact:     { color: 'text-amber-400 hover:text-amber-300',  bg: 'bg-amber-500/10 border-amber-500/20' },
    transition: { color: 'text-violet-400 hover:text-violet-300', bg: 'bg-violet-500/10 border-violet-500/20' },
    rhetorical: { color: 'text-rose-400 hover:text-rose-300',    bg: 'bg-rose-500/10 border-rose-500/20' },
  }
  const style = typeStyles[marker.pause_type] || typeStyles.breath

  return (
    <span
      className="relative inline-flex items-center mx-0.5"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
    >
      <button
        onClick={onRemove}
        className={`
          px-0.5 select-none transition-all duration-150 font-light text-base
          ${removed ? 'opacity-20 line-through' : style.color}
        `}
        title="Click to remove pause"
      >
        ·|·
      </button>
      {tooltipVisible && !removed && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30
                         bg-stage-700 border border-stage-500 rounded-lg px-3 py-2
                         text-xs text-white whitespace-nowrap shadow-xl pointer-events-none">
          <span className="font-semibold capitalize">{marker.pause_type} pause</span>
          <span className="text-stage-300 ml-1.5">{marker.min_duration_ms}–{marker.max_duration_ms} ms</span>
          <span className="block text-stage-400 text-[10px] mt-0.5">Click to remove</span>
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-stage-500" />
        </span>
      )}
    </span>
  )
}

function AnnotatedSentence({ sentence, onToggleHeroWord, onRemovePause }) {
  const words = sentence.text.split(' ')
  const removedPauses = new Set(sentence._removedPauseIndices || [])
  const disabledHeroWords = new Set(sentence._disabledHeroWords || [])

  const pauseMap = {}
  for (const pm of (sentence.pause_markers || [])) {
    pauseMap[pm.after_word_index] = pm
  }

  return (
    <span className="leading-[2] text-[0.9375rem]">
      {words.map((word, i) => {
        const isHero = (sentence.hero_words || []).includes(i)
        const isDisabled = disabledHeroWords.has(i)
        const pause = pauseMap[i]
        const pauseRemoved = removedPauses.has(i)

        return (
          <span key={i}>
            {isHero ? (
              <span
                onClick={() => onToggleHeroWord(sentence.sentence_id, i)}
                className={`
                  cursor-pointer rounded px-[3px] py-[1px] transition-all duration-150
                  ${isDisabled
                    ? 'text-stage-400 line-through decoration-stage-500/50'
                    : 'text-amber-400 bg-amber-500/10 font-semibold hover:bg-amber-500/15 hover:text-amber-300'
                  }
                `}
                title={isDisabled ? 'Click to re-enable emphasis' : 'Click to remove emphasis'}
              >
                {word}
              </span>
            ) : (
              <span className="text-stage-100">{word}</span>
            )}
            {pause && (
              <PauseMarkerIcon
                marker={pause}
                removed={pauseRemoved}
                onRemove={() => onRemovePause(sentence.sentence_id, i)}
              />
            )}
            {i < words.length - 1 && ' '}
          </span>
        )
      })}
      <span className="ml-2.5 text-[10px] bg-stage-700/80 text-stage-300 px-2 py-0.5 rounded-md font-mono">
        {sentence.target_wpm} wpm
      </span>
    </span>
  )
}

export default function AnnotationReview() {
  const { sessionId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const [sentences, setSentences] = useState([])
  const [paragraphs, setParagraphs] = useState([])
  const [skillLevel, setSkillLevel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!location.state?.annotation)

  useEffect(() => {
    if (location.state?.annotation) {
      setSentences(location.state.annotation.map(s => ({
        ...s, _disabledHeroWords: [], _removedPauseIndices: [],
      })))
      setParagraphs(location.state.paragraphs || [])
      setSkillLevel(location.state.skill_level || '')
      return
    }
    axios.get(`${API}/api/session/${sessionId}`)
      .then(({ data }) => {
        setSentences(data.sentences.map(s => ({
          ...s, _disabledHeroWords: [], _removedPauseIndices: [],
        })))
        setParagraphs(data.paragraphs || [])
        setSkillLevel(data.skill_level || '')
      })
      .catch(() => setError('Could not load session.'))
      .finally(() => setLoading(false))
  }, [sessionId, location.state])

  const handleToggleHeroWord = (sentenceId, wordIndex) => {
    setSentences(prev => prev.map(s => {
      if (s.sentence_id !== sentenceId) return s
      const disabled = new Set(s._disabledHeroWords || [])
      disabled.has(wordIndex) ? disabled.delete(wordIndex) : disabled.add(wordIndex)
      return { ...s, _disabledHeroWords: [...disabled] }
    }))
  }

  const handleRemovePause = (sentenceId, afterWordIndex) => {
    setSentences(prev => prev.map(s => {
      if (s.sentence_id !== sentenceId) return s
      const removed = new Set(s._removedPauseIndices || [])
      removed.has(afterWordIndex) ? removed.delete(afterWordIndex) : removed.add(afterWordIndex)
      return { ...s, _removedPauseIndices: [...removed] }
    }))
  }

  const handleStart = async () => {
    setSaving(true)
    setError(null)

    const cleanSentences = sentences.map(s => {
      const disabled = new Set(s._disabledHeroWords || [])
      const removedPauseIdxs = new Set(s._removedPauseIndices || [])
      return {
        ...s,
        hero_words: (s.hero_words || []).filter(i => !disabled.has(i)),
        pause_markers: (s.pause_markers || []).filter(pm => !removedPauseIdxs.has(pm.after_word_index)),
        _disabledHeroWords: undefined,
        _removedPauseIndices: undefined,
      }
    })

    try {
      await axios.patch(`${API}/api/session/${sessionId}/annotation`, { sentences: cleanSentences })
      navigate(`/session/${sessionId}`)
    } catch (err) {
      setError('Failed to save edits. ' + (err.response?.data?.detail || ''))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setSentences(prev => prev.map(s => ({
      ...s, _disabledHeroWords: [], _removedPauseIndices: [],
    })))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Skeleton header */}
        <div className="h-[57px] bg-stage-900/85 border-b border-stage-600/30" />
        <div className="flex-1 max-w-6xl mx-auto w-full px-5 py-8 flex gap-7">
          <div className="flex-1 min-w-0 space-y-5">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-6 space-y-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-md bg-stage-700" />
                  <div className="h-4 w-28 rounded bg-stage-700" />
                  <div className="ml-auto h-3 w-16 rounded bg-stage-700/60" />
                </div>
                {Array.from({ length: i + 1 }).map((_, j) => (
                  <div key={j} className="py-3 border-b border-stage-600/20 last:border-0 space-y-2">
                    <div className="h-4 rounded bg-stage-700/70" style={{ width: `${65 + (j * 11) % 30}%` }} />
                    <div className="h-4 rounded bg-stage-700/40" style={{ width: `${40 + (j * 17) % 40}%` }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="hidden xl:block w-64 flex-shrink-0 space-y-4">
            <div className="card p-5 space-y-3 animate-pulse">
              <div className="h-3 w-20 rounded bg-stage-700" />
              {[1, 2, 3].map(i => <div key={i} className="h-4 rounded bg-stage-700/60" />)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Counts for sidebar
  const totalHeroWords = sentences.reduce((acc, s) => acc + (s.hero_words?.length || 0), 0)
  const totalPauses = sentences.reduce((acc, s) => acc + (s.pause_markers?.length || 0), 0)
  const disabledHeroWords = sentences.reduce((acc, s) => acc + (s._disabledHeroWords?.length || 0), 0)
  const removedPauses = sentences.reduce((acc, s) => acc + (s._removedPauseIndices?.length || 0), 0)

  const sentencesByParagraph = paragraphs.map(ids =>
    ids.map(id => sentences.find(s => s.sentence_id === id)).filter(Boolean)
  )

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Sticky top bar ────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-stage-900/85 backdrop-blur-lg border-b border-stage-600/30">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4 relative">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden sm:flex items-center gap-2">
              <span className="font-display italic text-white/70 text-base">Clario</span>
              <span className="text-stage-500">·</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Review Annotations</p>
              <p className="text-xs text-stage-300 mt-0.5 hidden sm:block">
                {sentences.length} sentences across {paragraphs.length} paragraph{paragraphs.length !== 1 ? 's' : ''}
                {skillLevel && <span className="ml-2 text-stage-400">· {skillLevel}</span>}
              </p>
            </div>
          </div>

          {/* Step breadcrumb */}
          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1.5 text-[11px]">
            <span className="text-stage-500">Upload</span>
            <ChevronRight size={9} className="text-stage-600" />
            <span className="text-amber-400 font-semibold">Review</span>
            <ChevronRight size={9} className="text-stage-600" />
            <span className="text-stage-500">Practice</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={handleReset} className="btn-ghost py-2 px-3.5 text-xs gap-1.5">
              <RotateCcw size={12} />
              Reset
            </button>
            <button
              onClick={handleStart}
              disabled={saving}
              className="btn-primary py-2.5 px-5 text-sm"
            >
              {saving ? (
                <><Loader2 size={13} className="animate-spin" /> Saving…</>
              ) : (
                <><Mic size={13} /> Start Practice <ChevronRight size={13} /></>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── Body: two-column ──────────────────────────── */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-5 py-8 flex gap-7">

        {/* Main: annotation script */}
        <main className="flex-1 min-w-0 space-y-5">
          {error && (
            <div className="px-4 py-3 rounded-lg bg-rose-500/8 border border-rose-500/25 text-rose-400 text-sm animate-fade-in">
              {error}
            </div>
          )}

          {/* Interaction hint */}
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-stage-800/40 border border-stage-600/25 text-xs text-stage-300">
            <Info size={11} className="mt-0.5 flex-shrink-0 text-stage-400" />
            <span>
              Tap <span className="text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded text-[11px] font-medium mx-0.5">highlighted words</span> to toggle emphasis ·
              tap <span className="text-sky-400 font-light text-base leading-none mx-0.5">·|·</span> to remove a pause marker
            </span>
          </div>

          {sentencesByParagraph.map((paraSlice, paraIdx) => (
            <div
              key={paraIdx}
              className="card p-6 space-y-1 animate-fade-up"
              style={{ animationDelay: `${paraIdx * 0.04}s` }}
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="w-6 h-6 rounded-md bg-stage-600/50 flex items-center justify-center flex-shrink-0">
                  <span className="text-[11px] font-bold text-stage-200">{paraIdx + 1}</span>
                </div>
                <span className="text-sm font-semibold text-stage-100">Paragraph {paraIdx + 1}</span>
                <span className="ml-auto text-xs text-stage-400">{paraSlice.length} sentence{paraSlice.length !== 1 ? 's' : ''}</span>
              </div>

              <div className="space-y-0.5 divide-y divide-stage-600/20">
                {paraSlice.map(sentence => (
                  <div key={sentence.sentence_id} className="py-4 first:pt-0 last:pb-0">
                    <AnnotatedSentence
                      sentence={sentence}
                      onToggleHeroWord={handleToggleHeroWord}
                      onRemovePause={handleRemovePause}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p className="text-xs text-stage-400 px-1 pb-8">
            Edits are saved when you click "Start Practice". Toggling off a word removes its emphasis target; removing a pause marker means you won't be scored on it.
          </p>
        </main>

        {/* Sidebar: session summary + legend */}
        <aside className="hidden xl:flex flex-col w-64 flex-shrink-0 gap-5">
          <div className="sticky top-24 space-y-4">

            {/* Session summary */}
            <div className="card p-5 space-y-4">
              <p className="label">Your Script</p>
              <div className="space-y-3">
                {[
                  { Icon: FileText, label: 'Sentences', value: sentences.length },
                  { Icon: Star, label: 'Emphasis words', value: `${totalHeroWords - disabledHeroWords} active` },
                  { Icon: PauseCircle, label: 'Pause markers', value: `${totalPauses - removedPauses} active` },
                ].map(({ Icon, label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-stage-300">
                      <Icon size={13} />
                      <span className="text-xs">{label}</span>
                    </div>
                    <span className="text-xs font-semibold text-stage-100 font-mono">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="card p-5 space-y-4">
              <p className="label">Legend</p>
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded font-semibold text-[11px]">Word</span>
                  <span className="text-stage-300">= emphasis target (click to toggle)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-sky-400 font-light text-base leading-none">·|·</span>
                  <span className="text-stage-300">= breath pause</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-amber-400 font-light text-base leading-none">·|·</span>
                  <span className="text-stage-300">= impact pause</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-violet-400 font-light text-base leading-none">·|·</span>
                  <span className="text-stage-300">= transition pause</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[10px] bg-stage-700 px-1.5 py-0.5 rounded text-stage-300">130 wpm</span>
                  <span className="text-stage-300">= target pace</span>
                </div>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={handleStart}
              disabled={saving}
              className="btn-primary w-full py-3"
            >
              {saving ? (
                <><Loader2 size={14} className="animate-spin" /> Saving…</>
              ) : (
                <><Mic size={14} /> Start Practice <ChevronRight size={14} /></>
              )}
            </button>
          </div>
        </aside>

      </div>
    </div>
  )
}
