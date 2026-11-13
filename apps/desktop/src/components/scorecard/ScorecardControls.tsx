import { useEffect, useState } from 'react'
import { parseScorecardSymbols } from '@shared/scorecard'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useScorecard } from '@/stores/scorecard'

export function ScorecardControls() {
  const state = useScorecard()
  const { symbols, columns, chartMetric, comparisons, selectedId } = state
  const [draft, setDraft] = useState(symbols.join(', '))
  const [name, setName] = useState('')
  const [feedback, setFeedback] = useState({ text: '', error: false })
  const selected = comparisons.find(entry => entry.id === selectedId)
  const symbolSignature = symbols.join(',')
  useEffect(() => setDraft(symbols.join(', ')), [symbols])
  useEffect(() => setName(selected?.name ?? ''), [selected?.id, selected?.name])
  const parsed = parseScorecardSymbols(draft)
  const unapplied = Boolean(parsed.error) || parsed.symbols.join(',') !== symbolSignature
  const modified = selected && (selected.symbols.join(',') !== symbolSignature
    || selected.columns.join(',') !== columns.join(',') || selected.chartMetric !== chartMetric)
  const clearFeedback = () => setFeedback({ text: '', error: false })

  return <section className="scorecard-controls" aria-label="Comparison controls">
    <div className="scorecard-toolbar">
      <form className="scorecard-tickers" onSubmit={event => {
        event.preventDefault()
        if (parsed.error) { setFeedback({ text: parsed.error, error: true }); return }
        state.setSymbols(parsed.symbols)
        clearFeedback()
      }}>
        <label htmlFor="scorecard-tickers">Companies <span>3–6 tickers</span></label>
        <div><input id="scorecard-tickers" value={draft} onChange={event => { setDraft(event.target.value.toUpperCase()); clearFeedback() }}
          aria-invalid={feedback.error && Boolean(parsed.error)} aria-describedby="scorecard-controls-feedback"
          maxLength={90} spellCheck={false} autoComplete="off" placeholder="AMZN, MSFT, GOOGL" />
          <Button type="submit" variant="accent">Compare</Button></div>
      </form>
      <div className="scorecard-saved">
        <p>Saved comparisons <span>{selected ? modified ? 'Unsaved changes' : 'Saved locally' : `${comparisons.length} saved`}</span></p>
        <Select value={selectedId} aria-label="Saved scorecards" options={[{ value: '', label: 'Current comparison' }, ...comparisons.map(entry => ({ value: entry.id, label: entry.name }))]}
          onChange={id => { if (id) state.loadComparison(id); else state.clearSelection(); clearFeedback() }} />
      </div>
      <form className="scorecard-save" onSubmit={event => {
        event.preventDefault()
        if (unapplied) { setFeedback({ text: 'Compare the entered tickers before saving.', error: true }); return }
        const failure = state.saveComparison(name)
        setFeedback({ text: failure || `Saved “${name.trim()}” locally. The same name updates this comparison.`, error: Boolean(failure) })
      }}>
        <label htmlFor="scorecard-name">Save this view <span>Tickers + metrics</span></label>
        <div><input id="scorecard-name" value={name} onChange={event => { setName(event.target.value); clearFeedback() }} maxLength={60} placeholder="Name your comparison" />
          <Button type="submit" disabled={unapplied}>Save</Button><Button disabled={!selectedId} onClick={() => {
            state.deleteComparison(selectedId)
            setFeedback({ text: 'Saved comparison deleted. Current tickers remain displayed.', error: false })
          }}>Delete</Button></div>
      </form>
    </div>
    <div id="scorecard-controls-feedback" aria-live="polite" className={`scorecard-feedback ${feedback.error ? 'text-down' : ''}`}>
      {feedback.text ? <p role={feedback.error ? 'alert' : undefined}>{feedback.text}</p>
        : unapplied ? <p>Compare to apply the entered tickers.</p> : null}
    </div>
  </section>
}
