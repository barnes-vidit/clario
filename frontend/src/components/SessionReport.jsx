import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { Download, RotateCcw, Home, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, Play } from 'lucide-react'

const API = import.meta.env.VITE_BACKEND_URL

const DIMS = [
  { key: 'pacing',             label: 'Pacing',   color: '#F0A500' },
  { key: 'filler_words',       label: 'Fillers',  color: '#8B5CF6' },
  { key: 'pauses',             label: 'Pauses',   color: '#22D3EE' },
  { key: 'hero_word_emphasis', label: 'Emphasis', color: '#10B981' },
]

function buildRadarData(scores, sentences) {
  const first = { pacing: [], filler_words: [], pauses: [], hero_word_emphasis: [] }
  const last  = { pacing: [], filler_words: [], pauses: [], hero_word_emphasis: [] }

  for (const s of sentences) {
    const sid = String(s.sentence_id)
    const attempts = scores[sid]?.attempts || []
    if (!attempts.length) continue
    const f = attempts[0]
    const l = attempts[attempts.length - 1]
    for (const dim of Object.keys(first)) {
      if (f[dim] != null) first[dim].push(f[dim])
      if (l[dim] != null) last[dim].push(l[dim])
    }
  }

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0

  return DIMS.map(d => ({
    dimension: d.label,
    'First Attempt': avg(first[d.key]),
    'Final Attempt': avg(last[d.key]),
  }))
}

function buildTrendData(scores, sentences) {
  return sentences.map((s, i) => {
    const sid = String(s.sentence_id)
    const latest = scores[sid]?.latest || {}
    return {
      name: `S${i + 1}`,
      Pacing: latest.pacing ?? null,
      Fillers: latest.filler_words ?? null,
      Pauses: latest.pauses ?? null,
      Emphasis: latest.hero_word_emphasis ?? null,
    }
  }).filter(d => Object.values(d).some(v => v != null && v !== d.name))
}

const CustomRadarTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-stage-700 border border-stage-500 rounded-lg px-3 py-2.5 text-xs shadow-xl">
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-stage-300">{p.name}:</span>
          <span className="font-mono text-white">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function SessionReport() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    axios.post(`${API}/api/session/${sessionId}/report`)
      .then(({ data }) => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    if (!data) return

    const scores = data.scores || {}
    const sentences = data.sentences || []
    const allLatest = sentences.map(s => scores[String(s.sentence_id)]?.latest).filter(Boolean)

    if (!allLatest.length) return

    const avg = key => Math.round(allLatest.reduce((a, b) => a + (b[key] || 0), 0) / allLatest.length)
    const avgScores = {
      pacing: avg('pacing'),
      filler_words: avg('filler_words'),
      pauses: avg('pauses'),
      hero_word_emphasis: avg('hero_word_emphasis'),
    }

    const sorted = Object.entries(avgScores).sort((a, b) => b[1] - a[1])
    const topDim = sorted[0]
    const weakDim = sorted[sorted.length - 1]

    const dimNames = {
      pacing: 'pacing',
      filler_words: 'filler word reduction',
      pauses: 'pause placement',
      hero_word_emphasis: 'word emphasis',
    }

    setSummary([
      { icon: TrendingUp,   color: 'text-emerald-400', text: `Your strongest dimension was ${dimNames[topDim[0]]} at an average of ${topDim[1]}/100.` },
      { icon: TrendingDown, color: 'text-amber-400',   text: `Focus next session on ${dimNames[weakDim[0]]} — your average was ${weakDim[1]}/100.` },
      data.needs_review?.length
        ? { icon: AlertTriangle, color: 'text-amber-400', text: `${data.needs_review.length} sentence${data.needs_review.length !== 1 ? 's' : ''} were auto-advanced — consider running through those again.` }
        : { icon: CheckCircle2, color: 'text-emerald-400', text: 'You cleared every sentence on your own — excellent persistence.' },
    ])
  }, [data])

  const handleDownload = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clario-prep-${sessionId.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="min-h-screen px-5 py-10 animate-pulse">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Hero skeleton */}
          <div className="text-center space-y-6 py-4">
            <div className="inline-flex h-6 w-40 rounded-full bg-stage-700 mx-auto" />
            <div className="space-y-3">
              <div className="h-12 w-48 rounded-xl bg-stage-700 mx-auto" />
              <div className="h-4 w-64 rounded bg-stage-700/60 mx-auto" />
            </div>
            <div className="flex items-center justify-center gap-12 pt-2">
              <div className="space-y-2">
                <div className="h-12 w-20 rounded-lg bg-stage-700 mx-auto" />
                <div className="h-3 w-24 rounded bg-stage-700/50 mx-auto" />
              </div>
              <div className="w-px h-12 bg-stage-600" />
              <div className="space-y-2">
                <div className="h-12 w-20 rounded-lg bg-stage-700 mx-auto" />
                <div className="h-3 w-24 rounded bg-stage-700/50 mx-auto" />
              </div>
            </div>
          </div>

          {/* Score tiles skeleton */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="card p-5 text-center space-y-2">
                <div className="h-10 w-14 rounded-lg bg-stage-700 mx-auto" />
                <div className="h-3 w-16 rounded bg-stage-700/50 mx-auto" />
              </div>
            ))}
          </div>

          {/* Radar chart skeleton */}
          <div className="card p-7 space-y-4">
            <div className="h-3 w-52 rounded bg-stage-700" />
            <div className="h-[280px] rounded-xl bg-stage-800/60" />
          </div>

          {/* Takeaways skeleton */}
          <div className="space-y-4">
            <div className="h-3 w-28 rounded bg-stage-700 px-1" />
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-start gap-4 px-5 py-4 rounded-xl bg-stage-800/50 border border-stage-600/30">
                  <div className="w-4 h-4 rounded bg-stage-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded bg-stage-700/70" style={{ width: `${55 + i * 13}%` }} />
                    <div className="h-3 rounded bg-stage-700/40" style={{ width: `${35 + i * 9}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-stage-300 text-sm">Could not load session report.</p>
      </div>
    )
  }

  const { scores = {}, sentences = [], needs_review = [], skill_level = '' } = data

  const totalAttempts = sentences.reduce((acc, s) =>
    acc + (scores[String(s.sentence_id)]?.attempts?.length || 0), 0)

  const passedFirstCount = sentences.filter(s => {
    const attempts = scores[String(s.sentence_id)]?.attempts || []
    return attempts.length === 1 && scores[String(s.sentence_id)]?.passed
  }).length

  const passedFirstPct = sentences.length
    ? Math.round((passedFirstCount / sentences.length) * 100)
    : 0

  const radarData = buildRadarData(scores, sentences)
  const trendData = buildTrendData(scores, sentences)

  // Average scores per dimension for the tile row
  const allLatest = sentences.map(s => scores[String(s.sentence_id)]?.latest).filter(Boolean)
  const dimAvgs = DIMS.reduce((acc, d) => {
    const vals = allLatest.map(l => l[d.key]).filter(v => v != null)
    acc[d.key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    return acc
  }, {})

  return (
    <div className="min-h-screen px-5 py-10 animate-fade-up">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* ── Hero ───────────────────────────────────────── */}
        <div className="text-center space-y-6 py-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full
                          bg-emerald-500/10 border border-emerald-500/25
                          text-xs font-medium text-emerald-400">
            <CheckCircle2 size={11} />
            Prep Session Complete
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-[3.25rem] font-normal text-white leading-none tracking-tight">
              You're ready.
            </h1>
            <p className="text-stage-300 text-base">
              {sentences.length} sentences · {skill_level} level · {totalAttempts} total attempts
            </p>
            <p className="text-stage-400 text-sm">
              {needs_review.length > 0
                ? 'Run through the flagged sentences once more before you present.'
                : "You're in excellent shape — trust your preparation."}
            </p>
          </div>

          {/* Two big stats */}
          <div className="flex items-center justify-center gap-12 pt-2">
            <div className="text-center">
              <p className="font-display text-5xl font-bold text-white tabular-nums">{passedFirstPct}%</p>
              <p className="text-xs text-stage-300 mt-1.5 uppercase tracking-widest font-medium">Passed First Try</p>
            </div>
            <div className="w-px h-12 bg-stage-600" />
            <div className="text-center">
              {needs_review.length === 0 ? (
                <>
                  <CheckCircle2 size={44} className="text-emerald-400 mx-auto" strokeWidth={1.5} />
                  <p className="text-xs text-stage-300 mt-2 uppercase tracking-widest font-medium">Clean Run</p>
                </>
              ) : (
                <>
                  <p className="font-display text-5xl font-bold tabular-nums text-amber-400">{needs_review.length}</p>
                  <p className="text-xs text-stage-300 mt-1.5 uppercase tracking-widest font-medium">Needs Re-practice</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Score tiles ────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {DIMS.map(dim => {
            const val = dimAvgs[dim.key]
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

        {/* ── Radar chart — full width ────────────────────── */}
        <div className="card p-7 space-y-4">
          <p className="label">Performance: First vs. Final Attempt</p>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#1C2640" />
              <PolarAngleAxis dataKey="dimension" tick={{ fill: '#687A96', fontSize: 12 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#4A5C78', fontSize: 9 }} />
              <Radar name="First Attempt" dataKey="First Attempt" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.12} strokeWidth={1.5} />
              <Radar name="Final Attempt" dataKey="Final Attempt" stroke="#F0A500" fill="#F0A500" fillOpacity={0.18} strokeWidth={1.5} />
              <Tooltip content={<CustomRadarTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                formatter={v => <span style={{ color: '#94A3B8' }}>{v}</span>}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* ── Trend chart — full width ────────────────────── */}
        {trendData.length > 1 && (
          <div className="card p-7 space-y-4">
            <p className="label">Score Trend — Across Sentences</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1C2640" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#4A5C78', fontSize: 10 }}
                  axisLine={{ stroke: '#1C2640' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: '#4A5C78', fontSize: 10 }}
                  axisLine={{ stroke: '#1C2640' }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: '#131B2E',
                    border: '1px solid #2D3C5C',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#94A3B8' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={v => <span style={{ color: '#94A3B8' }}>{v}</span>}
                />
                {DIMS.map(d => (
                  <Line
                    key={d.key}
                    type="monotone"
                    dataKey={d.label}
                    stroke={d.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: d.color, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Key Takeaways ──────────────────────────────── */}
        {summary && (
          <div className="space-y-4">
            <p className="label px-1">Key Takeaways</p>
            <div className="space-y-3">
              {summary.map(({ icon: Icon, color, text }, i) => (
                <div
                  key={i}
                  className="flex items-start gap-4 px-5 py-4 rounded-xl bg-stage-800/50 border border-stage-600/30
                             animate-fade-up"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className={`mt-0.5 flex-shrink-0 ${color}`}>
                    <Icon size={16} />
                  </div>
                  <p className="text-sm text-stage-100 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Needs Re-practice ──────────────────────────── */}
        {needs_review.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <AlertTriangle size={14} className="text-amber-400" />
              <p className="label text-amber-400/80">Re-practice These ({needs_review.length})</p>
            </div>
            <div className="space-y-2">
              {needs_review.map(sid => {
                const s = sentences.find(s => s.sentence_id === sid)
                const latest = scores[String(sid)]?.latest
                return s ? (
                  <div
                    key={sid}
                    className="flex items-start gap-3 px-5 py-4 rounded-xl
                               bg-stage-800/40 border-l-2 border-amber-500/40
                               border border-stage-600/30"
                  >
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-sm text-stage-100 leading-snug">{s.text}</p>
                      {latest && (
                        <div className="flex flex-wrap gap-3">
                          {DIMS.map(d => (
                            <span key={d.key} className="text-xs text-stage-400 font-mono">
                              {d.label}:{' '}
                              <span style={{ color: d.color }}>{latest[d.key] ?? '—'}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null
              })}
            </div>
            <button onClick={() => navigate(`/session/${sessionId}`)} className="btn-ghost w-full">
              <RotateCcw size={13} /> Re-practice Flagged Sentences
            </button>
          </div>
        )}

        {/* ── Full Script Practice CTA ───────────────────────── */}
        <div className="card p-6 space-y-3">
          <div className="space-y-1">
            <p className="text-white font-medium text-sm">Ready to run it all the way through?</p>
            <p className="text-stage-400 text-xs">
              Practice your entire script in one continuous take — no demos, no retries.
              Scored on pacing consistency, overall flow, and delivery arc.
            </p>
          </div>
          <button
            onClick={() => navigate(`/session/${sessionId}/fullscript`)}
            className="btn-primary w-full"
          >
            <Play size={13} /> Practice Full Script
          </button>
        </div>

        {/* ── Actions ────────────────────────────────────── */}
        <div className="flex gap-4 pb-12">
          <button onClick={() => navigate('/')} className="btn-ghost flex-1">
            <Home size={13} /> New Session
          </button>
          <button onClick={handleDownload} className="btn-ghost flex-1">
            <Download size={13} /> Download Report
          </button>
        </div>

      </div>
    </div>
  )
}
