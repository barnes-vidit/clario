import { useEffect, useRef } from 'react'

export default function ScriptPanel({ sentences, currentSentenceId, needsReview = [] }) {
  const activeRef = useRef(null)
  const needsReviewSet = new Set(needsReview)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentSentenceId])

  function getSentenceState(sentence) {
    if (sentence.sentence_id === currentSentenceId) return 'active'
    if (sentence.sentence_id < currentSentenceId) {
      return needsReviewSet.has(sentence.sentence_id) ? 'flagged' : 'done'
    }
    return 'upcoming'
  }

  function getDistance(sentence) {
    const idx = sentences.findIndex(s => s.sentence_id === sentence.sentence_id)
    const activeIdx = sentences.findIndex(s => s.sentence_id === currentSentenceId)
    return idx - activeIdx
  }

  function getTeleClass(state, dist) {
    if (state === 'active') return 'tele-active'
    if (state === 'done') return 'tele-done'
    if (state === 'flagged') return 'tele-flagged'
    const absDist = Math.abs(dist)
    if (absDist <= 1) return 'tele-near'
    if (absDist <= 2) return 'tele-far'
    return 'tele-far'
  }

  // Render hero words + pause markers inline (read-only)
  function renderContent(sentence, state) {
    const words = sentence.text.split(' ')
    const heroSet = new Set(sentence.hero_words || [])
    const pauseMap = {}
    for (const pm of (sentence.pause_markers || [])) {
      pauseMap[pm.after_word_index] = pm
    }

    const isActive = state === 'active'

    return words.map((word, i) => (
      <span key={i}>
        <span className={
          isActive && heroSet.has(i)
            ? 'text-amber-400 font-semibold'
            : undefined
        }>
          {word}
        </span>
        {pauseMap[i] && isActive && (
          <span className="text-amber-500/50 mx-0.5 text-[10px]">|</span>
        )}
        {pauseMap[i] && !isActive && (
          <span className="text-stage-600 mx-0.5 text-[10px]">|</span>
        )}
        {i < words.length - 1 && ' '}
      </span>
    ))
  }

  // Group sentences by paragraph for visual separation
  const paraGroups = sentences.reduce((acc, s) => {
    const pid = s.paragraph_id ?? 0
    if (!acc[pid]) acc[pid] = []
    acc[pid].push(s)
    return acc
  }, {})

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-stage-600/30 flex-shrink-0">
        <p className="label">Script</p>
      </div>

      {/* Sentences */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {Object.entries(paraGroups).map(([paraId, paraSlice], pIdx) => (
          <div key={paraId}>
            {/* Paragraph divider (except first) */}
            {pIdx > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-px bg-stage-700/60" />
                <span className="text-[10px] text-stage-500 font-medium tracking-wider uppercase">¶</span>
                <div className="flex-1 h-px bg-stage-700/60" />
              </div>
            )}

            <div className="space-y-1.5">
              {paraSlice.map(sentence => {
                const state = getSentenceState(sentence)
                const dist = getDistance(sentence)
                const teleClass = getTeleClass(state, dist)
                const isActive = state === 'active'

                return (
                  <div
                    key={sentence.sentence_id}
                    ref={isActive ? activeRef : null}
                    className={`tele-line ${teleClass}`}
                    style={{ transition: 'all 0.35s ease' }}
                  >
                    {renderContent(sentence, state)}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Bottom padding for scroll */}
        <div className="h-24" />
      </div>
    </div>
  )
}
