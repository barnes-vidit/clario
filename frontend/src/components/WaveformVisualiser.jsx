import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { Zap } from 'lucide-react'

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-stage-700 border border-stage-500 rounded-lg px-3 py-2.5 text-xs shadow-xl">
      <p className="font-semibold text-white mb-1.5">{d.word}</p>
      <div className="space-y-1 text-stage-200">
        <p>Intensity: <span className="text-stage-100 font-mono">{d.intensity.toFixed(1)} dB</span></p>
        <p>Pitch: <span className="text-stage-100 font-mono">
          {d.pitch > 0 ? `${Math.round(d.pitch)} Hz` : '—'}
        </span></p>
        {d.isHero && <p className="flex items-center gap-1 text-amber-400 font-medium"><Zap size={9} /> Emphasis target</p>}
        {d.isPause && <p className="text-sky-400">· Pause marker</p>}
      </div>
    </div>
  )
}

export default function WaveformVisualiser({
  words, wordPitch, wordIntensity,
  heroWordIndices = [], pauseMarkers = [], detectedPauses = [],
}) {
  if (!words?.length || !wordIntensity?.length) return null

  const raw = wordIntensity.map(v => (isFinite(v) ? v : -80))
  const minDb = Math.min(...raw)
  const shift = minDb < 0 ? -minDb : 0

  const heroSet = new Set(heroWordIndices)
  const annotatedPauseSet = new Set((pauseMarkers || []).map(p => p.after_word_index))
  const detectedPauseSet = new Set((detectedPauses || []).map(p => p.after_word_index))

  const data = words.map((word, i) => ({
    word: word.text || word,
    intensity: (raw[i] ?? -80) + shift,
    pitch: wordPitch?.[i] ?? 0,
    isHero: heroSet.has(i),
    isPause: annotatedPauseSet.has(i),
    isDetectedPause: detectedPauseSet.has(i),
    index: i,
  }))

  return (
    <div className="w-full">
      <p className="label mb-3">Acoustic Profile</p>
      <div className="bg-stage-900/60 border border-stage-700/50 rounded-xl p-4">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barSize={10} margin={{ top: 16, right: 4, left: -28, bottom: 0 }}>
            <XAxis
              dataKey="word"
              tick={{ fontSize: 9, fill: '#4A5C78' }}
              interval="preserveStartEnd"
              axisLine={{ stroke: '#1C2640' }}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />

            {/* Annotated pause lines */}
            {[...annotatedPauseSet].map(idx => (
              <ReferenceLine
                key={`ap-${idx}`}
                x={data[idx]?.word}
                shape={(props) => {
                  const x = (props.x1 ?? props.x ?? 0) - 5
                  return (
                    <line
                      x1={x} y1={16}
                      x2={x} y2={110}
                      stroke="#8B5CF6"
                      strokeDasharray="3 3"
                      strokeWidth={1.5}
                      opacity={0.6}
                    />
                  )
                }}
              />
            ))}

            {/* Detected pause lines */}
            {[...detectedPauseSet].map(idx => (
              <ReferenceLine
                key={`dp-${idx}`}
                x={data[idx]?.word}
                stroke="#22D3EE"
                strokeWidth={1.5}
                strokeOpacity={0.7}
              />
            ))}

            <Bar dataKey="intensity" radius={[3, 3, 0, 0]}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.isHero ? '#F0A500' : '#22D3EE'}
                  fillOpacity={entry.isHero ? 0.9 : 0.45}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="flex flex-wrap gap-4 mt-2 px-1">
          <LegendBar color="#F0A500" opacity={0.9} label="Emphasis word" />
          <LegendBar color="#22D3EE" opacity={0.45} label="Regular word" />
          <LegendLine color="#8B5CF6" dashed label="Annotated pause" />
          <LegendLine color="#22D3EE" label="Detected pause" />
        </div>
      </div>
    </div>
  )
}

function LegendBar({ color, opacity = 1, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: color, opacity }} />
      <span className="text-[10px] text-stage-400">{label}</span>
    </div>
  )
}

function LegendLine({ color, dashed, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-4 h-[1.5px] rounded"
        style={
          dashed
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0, ${color} 3px, transparent 3px, transparent 6px)` }
            : { backgroundColor: color }
        }
      />
      <span className="text-[10px] text-stage-400">{label}</span>
    </div>
  )
}
