import { useState } from 'react'
import axios from 'axios'
import { ChevronRight, Loader2 } from 'lucide-react'
import RecordButton from './RecordButton'

const API = import.meta.env.VITE_BACKEND_URL

const DIM_LABELS = {
  pacing: 'Pacing',
  filler_words: 'Fillers',
  pauses: 'Pauses',
  hero_word_emphasis: 'Emphasis',
}


export default function ParagraphReport({ sessionId, paragraphId, sentences, onContinue }) {
  const [phase, setPhase] = useState('prompt')
  const [paraAnalysis, setParaAnalysis] = useState(null)
  const [paraScores, setParaScores] = useState(null)
  const [error, setError] = useState(null)
  const [practicedScores, setPracticedScores] = useState({})

  const handleRecordingComplete = async (blob, mimeType) => {
    setPhase('analysing')
    setError(null)

    try {
      const form = new FormData()
      form.append('audio', blob, `paragraph.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`)
      form.append('session_id', sessionId)
      form.append('paragraph_id', String(paragraphId))
      form.append('type', 'paragraph')

      const { data: analysis } = await axios.post(`${API}/api/analyse`, form)
      setParaAnalysis(analysis)

      const { data: sessionData } = await axios.get(`${API}/api/session/${sessionId}`)
      const scores = sessionData.scores || {}

      const practiced = {}
      for (const s of sentences) {
        practiced[s.sentence_id] = scores[String(s.sentence_id)]?.latest || null
      }
      setPracticedScores(practiced)

      const paraScore = {
        pacing: computePacingScore(analysis.wpm, sentences),
        filler_words: Math.max(0, 100 - (analysis.filler_words_found?.length || 0) * 20),
        pauses: 100,
        hero_word_emphasis: 100,
      }
      setParaScores(paraScore)
      setPhase('results')
    } catch (err) {
      setError('Analysis failed — ' + (err.response?.data?.detail || 'please try again'))
      setPhase('prompt')
    }
  }

  function computePacingScore(wpm, sentences) {
    if (!sentences.length) return 100
    const avgTarget = sentences.reduce((acc, s) => acc + (s.target_wpm || 130), 0) / sentences.length
    const deviation = Math.abs(wpm - avgTarget) / avgTarget
    return Math.max(0, Math.round(100 - deviation * 100))
  }

  const sentenceCount = sentences.length
  let heldCount = 0

  if (paraScores && Object.keys(practicedScores).length > 0) {
    for (const s of sentences) {
      const practiced = practicedScores[s.sentence_id]
      if (!practiced) continue
      const dims = ['pacing', 'filler_words', 'pauses', 'hero_word_emphasis']
      if (dims.every(d => (paraScores[d] ?? 0) >= (practiced[d] ?? 0) - 5)) heldCount++
    }
  }

  const retentionPct = sentenceCount > 0 ? Math.round((heldCount / sentenceCount) * 100) : 0

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl space-y-6 animate-fade-up">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full
                          bg-violet-500/15 border border-violet-500/25
                          text-xs font-medium text-violet-300 mb-2">
            Paragraph {paragraphId + 1} Complete
          </div>
          <h2 className="font-display text-3xl font-normal text-white">Retention Check</h2>
          <p className="text-stage-300 text-sm max-w-xs mx-auto">
            Now say the full paragraph without stopping — natural delivery.
          </p>
        </div>

        {/* Prompt phase */}
        {phase === 'prompt' && (
          <div className="card p-8 flex flex-col items-center gap-6">
            {/* Script preview */}
            <div className="w-full space-y-2 px-4 py-4 rounded-lg bg-stage-900/50 border border-stage-700/40">
              {sentences.map(s => (
                <p key={s.sentence_id} className="text-sm text-stage-200 leading-relaxed">{s.text}</p>
              ))}
            </div>

            <RecordButton onRecordingComplete={handleRecordingComplete} />

            {error && <p className="text-xs text-rose-400 text-center">{error}</p>}
          </div>
        )}

        {/* Analysing */}
        {phase === 'analysing' && (
          <div className="card p-16 flex flex-col items-center gap-4">
            <div className="flex items-center gap-2">
              {[0, 160, 320].map((d, i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce-dot"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
            <p className="text-stage-300 text-sm">Analysing your paragraph…</p>
          </div>
        )}

        {/* Results */}
        {phase === 'results' && paraScores && paraAnalysis && (
          <div className="space-y-4">

            {/* Summary */}
            <div className="card p-6 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-white font-semibold text-lg">
                  {heldCount}/{sentenceCount} improvements held
                </p>
                <p className="text-stage-300 text-sm">
                  Sentence-level gains carried into the full paragraph.
                </p>
              </div>
              <p className={`font-display text-4xl font-bold tabular-nums ${
                retentionPct >= 70 ? 'text-emerald-400' :
                retentionPct >= 40 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {retentionPct}%
              </p>
            </div>

            {/* Paragraph scores grid */}
            <div className="card p-5 space-y-3">
              <p className="label">Paragraph Performance</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(DIM_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-stage-800/50 border border-stage-600/20">
                    <span className="text-xs text-stage-300">{label}</span>
                    <span className="font-mono text-sm font-semibold text-white">{paraScores?.[key] ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-sentence practice scores */}
            {sentences.some(s => practicedScores[s.sentence_id]) && (
              <div className="card p-5 space-y-3">
                <p className="label">Sentence Scores (Practice)</p>
                <div className="space-y-1.5">
                  {sentences.map(s => {
                    const practiced = practicedScores[s.sentence_id]
                    if (!practiced) return null
                    return (
                      <div key={s.sentence_id} className="flex items-center gap-3 py-2 border-b border-stage-700/30 last:border-0">
                        <p className="text-xs text-stage-200 flex-1 truncate min-w-0">
                          {s.text.slice(0, 45)}{s.text.length > 45 ? '…' : ''}
                        </p>
                        <div className="flex gap-3 flex-shrink-0">
                          {Object.keys(DIM_LABELS).map(d => (
                            <span key={d} className="text-[11px] font-mono text-stage-300">
                              {practiced[d] ?? '—'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-3 pt-1">
                  {Object.values(DIM_LABELS).map(l => (
                    <span key={l} className="text-[10px] text-stage-500 flex-1 text-center">{l}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Quick stats */}
            <div className="flex flex-wrap gap-4 px-1 text-xs text-stage-400">
              <span>Pace: <span className="font-mono text-stage-200">{paraAnalysis.wpm} wpm</span></span>
              <span>Duration: <span className="font-mono text-stage-200">{paraAnalysis.duration_s}s</span></span>
              {paraAnalysis.filler_words_found?.length > 0 && (
                <span className="text-rose-400">Fillers: {paraAnalysis.filler_words_found.join(', ')}</span>
              )}
            </div>

            <button onClick={onContinue} className="btn-primary w-full py-3.5">
              Continue to Next Paragraph <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
