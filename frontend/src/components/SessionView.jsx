import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { Play, RotateCcw, ChevronRight, Volume2, VolumeX, Loader2, Mic, FileText, Activity, MessageSquare } from 'lucide-react'
import ScriptPanel from './ScriptPanel'
import RecordButton from './RecordButton'
import ScoreCard from './ScoreCard'
import WaveformVisualiser from './WaveformVisualiser'
import ParagraphReport from './ParagraphReport'

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

const API = import.meta.env.VITE_BACKEND_URL
const WS_URL = import.meta.env.VITE_BACKEND_WS_URL

export default function SessionView() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [sentences, setSentences] = useState([])
  const [paragraphs, setParagraphs] = useState([])
  const [skillLevel, setSkillLevel] = useState('')
  const [loadingSession, setLoadingSession] = useState(true)

  const [currentSentenceId, setCurrentSentenceId] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  const [phase, setPhase] = useState('demo')
  const [needsReview, setNeedsReview] = useState([])

  const [demoLoading, setDemoLoading] = useState(false)
  const [demoUrl, setDemoUrl] = useState(null)
  const [demoPlaying, setDemoPlaying] = useState(false)
  const [demoMuted, setDemoMuted] = useState(false)
  const audioRef = useRef(null)
  const prevDemoUrlRef = useRef(null)

  const [analysisResult, setAnalysisResult] = useState(null)
  const [feedbackResult, setFeedbackResult] = useState(null)

  const [paragraphReviewData, setParagraphReviewData] = useState(null)
  const [completedParaId, setCompletedParaId] = useState(null)
  const [isActivelyRecording, setIsActivelyRecording] = useState(false)
  const recordButtonRef = useRef(null)

  const [displayStep, setDisplayStep] = useState(0)
  const carouselIntervalRef = useRef(null)

  const coachWsRef = useRef(null)
  const audioCtxRef = useRef(null)
  const nextStartTimeRef = useRef(0)
  const [coachSpeaking, setCoachSpeaking] = useState(false)

  const skipNextDemoLoad = useRef(false)

  // ─── Load session ───────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API}/api/session/${sessionId}`)
      .then(({ data }) => {
        setSentences(data.sentences)
        setParagraphs(data.paragraphs || [])
        setSkillLevel(data.skill_level)
        setCurrentSentenceId(data.current_sentence_id || 0)
        setNeedsReview(data.needs_review || [])
      })
      .catch(() => navigate('/'))
      .finally(() => setLoadingSession(false))
  }, [sessionId, navigate])

  // ─── Coach WebSocket ─────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return

    const ws = new WebSocket(`${WS_URL}/ws/coach/${sessionId}`)
    coachWsRef.current = ws
    audioCtxRef.current = new AudioContext({ sampleRate: 24000 })

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'audio_chunk') {
        const ctx = audioCtxRef.current
        if (ctx.state === 'suspended') await ctx.resume()

        const raw = atob(msg.data)
        const bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)

        const pcm16 = new Int16Array(bytes.buffer)
        const float32 = new Float32Array(pcm16.length)
        for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0

        const buffer = ctx.createBuffer(1, float32.length, 24000)
        buffer.getChannelData(0).set(float32)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)

        const startAt = Math.max(nextStartTimeRef.current, ctx.currentTime)
        source.start(startAt)
        nextStartTimeRef.current = startAt + buffer.duration

        setCoachSpeaking(true)
        source.onended = () => {
          if (nextStartTimeRef.current <= ctx.currentTime) setCoachSpeaking(false)
        }
      }
      if (msg.type === 'turn_complete') {
        nextStartTimeRef.current = 0
      }
    }

    ws.onerror = () => console.warn('Coach WS error')
    return () => ws.close()
  }, [sessionId])

  const speakCoachFeedback = useCallback((text) => {
    if (coachWsRef.current?.readyState === WebSocket.OPEN) {
      coachWsRef.current.send(JSON.stringify({ type: 'speak', text }))
    }
  }, [])

  // ─── Demo TTS ────────────────────────────────────────────────────
  const loadDemo = useCallback(async (sentenceId) => {
    setDemoLoading(true)
    setDemoUrl(null)
    setAnalysisResult(null)
    setFeedbackResult(null)

    try {
      const resp = await axios.post(
        `${API}/api/tts/demo`,
        { session_id: sessionId, sentence_id: sentenceId },
        { responseType: 'blob' }
      )
      if (prevDemoUrlRef.current) URL.revokeObjectURL(prevDemoUrlRef.current)
      const url = URL.createObjectURL(resp.data)
      prevDemoUrlRef.current = url
      setDemoUrl(url)
    } catch {
      setPhase('record')
    } finally {
      setDemoLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (!loadingSession && sentences.length > 0) {
      if (skipNextDemoLoad.current) { skipNextDemoLoad.current = false; return }
      setPhase('demo')
      loadDemo(currentSentenceId)
    }
  }, [loadingSession, currentSentenceId]) // eslint-disable-line

  useEffect(() => {
    if (demoUrl && audioRef.current) {
      audioRef.current.src = demoUrl
      audioRef.current.play().catch(() => { })
      setDemoPlaying(true)
    }
  }, [demoUrl])

  const handleDemoEnded = () => { setDemoPlaying(false); setPhase('record') }

  const handleDemoReplay = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.play()
      setDemoPlaying(true)
      setPhase('demo')
    }
  }

  // ─── Recording complete ──────────────────────────────────────────
  const handleRecordingComplete = useCallback(async (blob, mimeType) => {
    setIsActivelyRecording(false)
    setPhase('analysing')
    setDisplayStep(0)

    // Carousel: cycle through all 4 steps at equal intervals
    clearInterval(carouselIntervalRef.current)
    carouselIntervalRef.current = setInterval(() => {
      setDisplayStep(s => (s + 1) % 4)
    }, 2000)

    const sentence = sentences.find(s => s.sentence_id === currentSentenceId)
    if (!sentence) return

    try {
      const form = new FormData()
      form.append('audio', blob, `recording.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`)
      form.append('session_id', sessionId)
      form.append('sentence_id', String(currentSentenceId))
      form.append('type', 'sentence')

      const { data: analysis } = await axios.post(`${API}/api/analyse`, form)
      setAnalysisResult(analysis)

      const { data: feedback } = await axios.post(`${API}/api/feedback`, {
        session_id: sessionId,
        sentence_id: currentSentenceId,
        retry_num: retryCount,
        ...analysis,
      })

      clearInterval(carouselIntervalRef.current)
      setFeedbackResult(feedback)
      setPhase('feedback')

      if (feedback.coaching_text) speakCoachFeedback(feedback.coaching_text)

      if (feedback.auto_advanced) {
        setNeedsReview(prev => [...new Set([...prev, currentSentenceId])])
      }
    } catch {
      clearInterval(carouselIntervalRef.current)
      setPhase('record')
    }
  }, [sentences, currentSentenceId, sessionId, retryCount, speakCoachFeedback])

  // ─── Advance ────────────────────────────────────────────────────
  const handleAdvance = useCallback(async () => {
    try {
      const { data } = await axios.post(`${API}/api/session/${sessionId}/advance`)

      if (data.status === 'paragraph_complete') {
        skipNextDemoLoad.current = true
        setCompletedParaId(data.completed_paragraph_id)
        setCurrentSentenceId(data.next_sentence_id)
        setPhase('paragraph_review')
        setParagraphReviewData(null)
        setRetryCount(0)
      } else if (data.status === 'complete') {
        navigate(`/report/${sessionId}`)
      } else {
        setCurrentSentenceId(data.next_sentence_id)
        setRetryCount(0)
      }
    } catch { /* ignore */ }
  }, [sessionId, navigate])

  const handleRetry = useCallback(() => {
    setRetryCount(prev => prev + 1)
    setAnalysisResult(null)
    setFeedbackResult(null)
    setPhase('record')
  }, [])

  const handleParagraphReviewDone = useCallback(() => {
    setPhase('demo')
    loadDemo(currentSentenceId)
  }, [currentSentenceId, loadDemo])

  // Space bar to start/stop recording
  useEffect(() => {
    if (phase !== 'record') return
    const handleKey = (e) => {
      if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        recordButtonRef.current?.trigger()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase])

  // ─── Loading ────────────────────────────────────────────────────
  if (loadingSession) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 size={28} className="animate-spin text-amber-400" />
        <p className="text-stage-300 text-sm">Loading session…</p>
      </div>
    )
  }

  if (phase === 'paragraph_review' && completedParaId != null) {
    const paraSlice = paragraphs[completedParaId] || []
    const paraSentences = paraSlice.map(id => sentences.find(s => s.sentence_id === id)).filter(Boolean)
    return (
      <ParagraphReport
        sessionId={sessionId}
        paragraphId={completedParaId}
        sentences={paraSentences}
        onContinue={handleParagraphReviewDone}
      />
    )
  }

  const currentSentence = sentences.find(s => s.sentence_id === currentSentenceId)
  const currentSentenceIndex = sentences.findIndex(s => s.sentence_id === currentSentenceId)
  const totalSentences = sentences.length
  const progress = totalSentences > 0 ? ((currentSentenceIndex + 1) / totalSentences) * 100 : 0

  const isRecordPhase = phase === 'record' || phase === 'analysing'

  return (
    <div className="min-h-screen flex flex-col">

      {/* Progress bar — top of screen */}
      <div className="h-[3px] bg-stage-700 fixed top-0 left-0 right-0 z-50">
        <div
          className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Hidden demo audio */}
      <audio ref={audioRef} onEnded={handleDemoEnded} muted={demoMuted} />

      {/* ── Layout ───────────────────────────────────────────────── */}
      <div className="flex-1 flex" style={{ height: '100vh', paddingTop: 2 }}>

        {/* Script panel */}
        <div className="w-[260px] flex-shrink-0 bg-stage-950/70 border-r border-stage-700/40 overflow-hidden flex flex-col">
          <ScriptPanel
            sentences={sentences}
            currentSentenceId={currentSentenceId}
            needsReview={needsReview}
          />
        </div>

        {/* Main coaching area */}
        <div
          className={`flex-1 overflow-y-auto flex flex-col transition-all duration-500 ${isRecordPhase ? 'recording-ambient' : ''}`}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-8 py-4 border-b border-stage-700/30 flex-shrink-0">
            <div className="flex items-center gap-3">
              <span className="label">Sentence {currentSentenceIndex + 1} of {totalSentences}</span>
              {skillLevel && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full
                                 bg-stage-700 text-stage-300 border border-stage-600 uppercase tracking-widest">
                  {skillLevel}
                </span>
              )}
              {retryCount > 0 && phase !== 'feedback' && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full
                                 bg-amber-500/15 text-amber-400 border border-amber-500/25 uppercase tracking-widest">
                  Retry {retryCount}/3
                </span>
              )}
            </div>

            <button
              onClick={() => setDemoMuted(m => !m)}
              className="text-stage-400 hover:text-stage-200 transition-colors"
              title={demoMuted ? 'Unmute demo' : 'Mute demo'}
            >
              {demoMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
          </div>

          {/* ── Phase: DEMO ──────────────────────────────────────── */}
          {phase === 'demo' && (
            <div className="flex-1 flex flex-col px-8 py-8 animate-fade-up">
              <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col space-y-6">

                {/* Sentence text — large */}
                <div className="space-y-2">
                  <p className="label">Current sentence</p>
                  <p className="text-[1.25rem] font-medium text-white leading-relaxed max-w-2xl">
                    {currentSentence ? renderSentenceWithHighlights(currentSentence) : '…'}
                  </p>
                </div>

                {/* Demo player */}
                <div className="flex items-center gap-5 py-4 px-5 rounded-xl bg-stage-800/50 border border-stage-600/30 max-w-lg">
                  <div className={`
                  flex items-center gap-2.5 text-sm flex-1
                  ${demoLoading ? 'text-stage-400' : demoPlaying ? 'text-amber-400' : 'text-stage-300'}
                `}>
                    {demoLoading ? (
                      <><Loader2 size={14} className="animate-spin" /> Generating demo…</>
                    ) : demoPlaying ? (
                      <>
                        <span className="flex gap-0.5 items-end h-4" aria-hidden>
                          {[0, 0.15, 0.06, 0.22, 0.1].map((d, i) => (
                            <span
                              key={i}
                              className="w-[3px] bg-amber-400 rounded-full origin-bottom animate-waveform"
                              style={{ height: '100%', animationDelay: `${d}s` }}
                            />
                          ))}
                        </span>
                        AI demonstrating…
                      </>
                    ) : demoUrl ? (
                      <><Volume2 size={14} /> Demo complete — your turn</>
                    ) : (
                      <span className="text-rose-400/80">Demo unavailable</span>
                    )}
                  </div>
                  {demoUrl && !demoLoading && (
                    <button onClick={handleDemoReplay} className="btn-ghost py-1.5 px-3 text-xs gap-1.5 flex-shrink-0">
                      <Play size={11} /> Replay
                    </button>
                  )}
                </div>

                {/* Annotations summary */}
                {currentSentence && (
                  <div className="flex flex-wrap gap-4 text-xs text-stage-400">
                    <span>
                      Target pace:{' '}
                      <span className="font-mono text-stage-200">{currentSentence.target_wpm} wpm</span>
                    </span>
                    {currentSentence.hero_words?.length > 0 && (
                      <span>
                        <span className="text-amber-400/70">{currentSentence.hero_words.length}</span>
                        {' '}emphasis word{currentSentence.hero_words.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {currentSentence.pause_markers?.length > 0 && (
                      <span>
                        <span className="text-stage-300">{currentSentence.pause_markers.length}</span>
                        {' '}pause{currentSentence.pause_markers.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}

                {/* Record button — visible but dimmed waiting for demo */}
                <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-40 pointer-events-none">
                  <RecordButton onRecordingComplete={handleRecordingComplete} disabled={true} />
                </div>
              </div>
            </div>
          )}

          {/* ── Phase: RECORD ────────────────────────────────────── */}
          {phase === 'record' && (
            <div className="flex-1 flex flex-col px-8 py-8 animate-fade-up">
              <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col">
                {/* Sentence at top — dims while actively recording */}
                <div
                  className="space-y-2 mb-8 transition-opacity duration-300"
                  style={{ opacity: isActivelyRecording ? 0.35 : 1 }}
                >
                  <div className="flex items-center gap-3">
                    <p className="label">Your turn — match the delivery</p>
                    <span className="text-[10px] text-stage-500 font-mono">Space to record</span>
                  </div>
                  <p className="text-[1.125rem] font-medium text-white/90 leading-relaxed max-w-2xl">
                    {currentSentence ? renderSentenceWithHighlights(currentSentence) : '…'}
                  </p>
                </div>

                {/* Record button — centered, spacious */}
                <div className="flex-1 flex flex-col items-center justify-center gap-6">
                  <RecordButton
                    ref={recordButtonRef}
                    onRecordingComplete={handleRecordingComplete}
                    onRecordingStart={() => {
                      setIsActivelyRecording(true)
                      audioCtxRef.current?.resume()
                    }}
                    disabled={false}
                  />
                  <p
                    className="text-xs text-stage-400 text-center max-w-[200px] leading-relaxed transition-opacity duration-300"
                    style={{ opacity: isActivelyRecording ? 0.2 : 1 }}
                  >
                    Say the sentence above. Match the AI's pace, pauses, and emphasis.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Phase: ANALYSING ─────────────────────────────────── */}
          {phase === 'analysing' && (() => {
            const STEPS = [
              { Icon: Mic, label: 'Preparing audio', sub: 'Converting recording to WAV' },
              { Icon: FileText, label: 'Transcribing speech', sub: 'Recognising words & timestamps' },
              { Icon: Activity, label: 'Measuring pacing & pitch', sub: 'WPM · pauses · emphasis' },
              { Icon: MessageSquare, label: 'Generating feedback', sub: 'Scoring against your targets' },
            ]
            const { Icon, label, sub } = STEPS[displayStep]
            return (
              <div className="flex-1 flex flex-col px-8 py-8 animate-fade-up">
                <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col justify-center gap-10">

                  {/* Sentence being analysed */}
                  <p className="text-[1.0625rem] font-medium text-white/35 leading-relaxed border-l-2 border-stage-700 pl-4">
                    {currentSentence?.text || '…'}
                  </p>

                  {/* Fixed spotlight card — content slides up into it */}
                  <div className="relative">
                    {/* Card frame — never moves */}
                    <div className="px-6 py-5 rounded-2xl bg-stage-800/60 border border-stage-600/35 overflow-hidden">
                      {/* Animated content — remounts on each step change */}
                      <div key={displayStep} className="flex items-center gap-5 animate-fade-up">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/12 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                          <Icon size={17} className="text-indigo-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.9375rem] font-semibold text-white leading-none">{label}</p>
                          <p className="text-xs text-stage-300 mt-1.5 leading-none">{sub}</p>
                        </div>
                        {/* Live waveform bars */}
                        <span className="flex gap-[3px] items-end h-4 flex-shrink-0">
                          {[0, 120, 240, 100, 200].map((d, j) => (
                            <span
                              key={j}
                              className="w-[3px] rounded-full bg-indigo-400/70 origin-bottom animate-waveform"
                              style={{ height: '100%', animationDelay: `${d}ms`, animationDuration: `${1.4 + j * 0.15}s` }}
                            />
                          ))}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Carousel position dots */}
                  <div className="flex items-center justify-center gap-2">
                    {[0, 1, 2, 3].map(i => (
                      <span
                        key={i}
                        className={`rounded-full transition-all duration-500 ${i === displayStep
                            ? 'w-4 h-1.5 bg-indigo-400'
                            : 'w-1.5 h-1.5 bg-stage-600'
                          }`}
                      />
                    ))}
                  </div>

                </div>
              </div>
            )
          })()}

          {/* ── Phase: FEEDBACK ──────────────────────────────────── */}
          {phase === 'feedback' && feedbackResult && (
            <div className="flex-1 flex flex-col px-8 py-8 animate-fade-up">
              <div className="max-w-3xl w-full mx-auto space-y-6">

                {/* The sentence that was practiced */}
                <p className="text-[1.0625rem] font-medium text-white/70 leading-relaxed border-l-2 border-stage-600 pl-4">
                  {currentSentence?.text}
                </p>

                {/* Score card */}
                <div className="card p-5">
                  <ScoreCard
                    scores={feedbackResult.scores}
                    thresholds={feedbackResult.thresholds}
                    passed={feedbackResult.passed}
                    autoAdvanced={feedbackResult.auto_advanced}
                    retryNum={retryCount}
                  />
                </div>

                {/* Coach message */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="label">Coach</p>
                    {coachSpeaking && (
                      <span className="flex items-center gap-1.5 text-xs text-amber-400">
                        <span className="flex gap-0.5 items-end h-3">
                          {[0, 0.1, 0.2].map((d, i) => (
                            <span
                              key={i}
                              className="w-[2px] bg-amber-400 rounded-full origin-bottom animate-waveform"
                              style={{ height: '100%', animationDelay: `${d}s` }}
                            />
                          ))}
                        </span>
                        Speaking
                      </span>
                    )}
                  </div>
                  <div className="pl-4 border-l-2 border-stage-600">
                    <p className="text-[0.9375rem] text-stage-100 leading-relaxed italic">
                      {'“'}{feedbackResult.coaching_text}{'”'}
                    </p>
                  </div>
                </div>

                {/* Waveform */}
                {analysisResult && currentSentence && (
                  <div className="card p-5 space-y-4">
                    <WaveformVisualiser
                      words={analysisResult.words}
                      wordPitch={analysisResult.word_pitch}
                      wordIntensity={analysisResult.word_intensity}
                      heroWordIndices={currentSentence.hero_words || []}
                      pauseMarkers={currentSentence.pause_markers || []}
                      detectedPauses={analysisResult.pauses || []}
                    />
                    {/* Transcript + quick stats */}
                    <div className="border-t border-stage-700/50 pt-4 space-y-2">
                      <p className="label mb-1.5">Transcribed</p>
                      <p className="text-sm text-stage-200 italic">"{analysisResult.transcript}"</p>
                      <div className="flex flex-wrap gap-4 mt-1">
                        <span className="text-xs text-stage-400">
                          Pace: <span className="font-mono text-stage-200">{analysisResult.wpm} wpm</span>
                        </span>
                        <span className="text-xs text-stage-400">
                          Duration: <span className="font-mono text-stage-200">{analysisResult.duration_s}s</span>
                        </span>
                        {analysisResult.filler_words_found?.length > 0 && (
                          <span className="text-xs text-rose-400">
                            Fillers: {analysisResult.filler_words_found.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3 pb-8">
                  {!feedbackResult.passed && !feedbackResult.auto_advanced && retryCount < 3 && (
                    <button onClick={handleRetry} className="btn-ghost flex-1">
                      <RotateCcw size={13} />
                      Try Again
                    </button>
                  )}
                  <button onClick={handleAdvance} className="btn-primary flex-1">
                    {feedbackResult.passed ? 'Next Sentence' : 'Move On'}
                    <ChevronRight size={13} />
                  </button>
                </div>

              </div>
            </div>
          )}
        </div>
      </div >
    </div >
  )
}

