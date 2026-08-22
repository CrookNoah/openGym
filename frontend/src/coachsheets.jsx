// Talking to the coach, and reading the week back.
//
// The engine (lib/coach.js) will not let the model invent a number or touch your state; this
// file is the other half of that promise — every action it suggests arrives here as a card
// with a button on it, and nothing changes until the button is pressed. The reply streams in
// as it is written, because a coach that makes you wait for a full paragraph before saying
// anything is a coach you stop asking.

import { useState, useRef, useEffect } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { todayISO, DAYN, fmtNum } from './lib/format.js'
import { askCoach, weeklyReview } from './lib/coach.js'
import { hasKey } from './lib/foodai.js'
import { verdictLine, applyAdjustment, goalOf } from './lib/goal.js'
import { exOr } from './lib/exercises.js'
import { aiKeySheet } from './foodsheets.jsx'
import Icon from './components/Icon.jsx'
import { Button, TextField } from './components/ui.jsx'

const ui = () => useUI.getState()
const update = (...a) => useStore.getState().update(...a)

/* ============================ proposals ============================ */

/** One suggested change, as a sentence and a button. Nothing here has happened yet. */
function Proposal({ p, onDone }) {
  const S = useStore(s => s.S)
  const [applied, setApplied] = useState(false)
  const routineNamed = name => (S.routines || []).find(r => r.name.toLowerCase() === String(name || '').toLowerCase())

  // Each proposal validates against real state at the moment it is pressed, not at the
  // moment it was suggested — a routine renamed mid-conversation must not silently write
  // to the wrong place.
  const apply = () => {
    const i = p.input || {}
    if (p.kind === 'swap_days') {
      update(s => {
        const a = i.day_a, b = i.day_b
        const va = s.week[a], vb = s.week[b]
        if (vb) s.week[a] = vb; else delete s.week[a]
        if (va) s.week[b] = va; else delete s.week[b]
        s.weekEdited = todayISO()
      })
    } else if (p.kind === 'set_day') {
      const rest = String(i.routine_name || '').toLowerCase() === 'rest'
      const r = rest ? null : routineNamed(i.routine_name)
      if (!rest && !r) { ui().toast(t('That routine no longer exists.')); return }
      update(s => { if (rest) delete s.week[i.day]; else s.week[i.day] = r.id; s.weekEdited = todayISO() })
    } else if (p.kind === 'add_exercise') {
      const r = routineNamed(i.routine_name)
      const ex = exOr(i.exercise_id)
      if (!r || !ex || !ex.id) { ui().toast(t('That exercise or routine no longer exists.')); return }
      update(s => {
        const rr = s.routines.find(x => x.id === r.id)
        if (rr && !rr.ex.some(e => e.id === ex.id)) {
          rr.ex.push({ id: ex.id, sets: Math.max(1, Math.min(6, i.sets || 3)), reps: Math.max(1, Math.min(30, i.reps || 10)), mode: 'reps' })
        }
      })
    } else if (p.kind === 'set_calorie_target') {
      update(s => { s.foodTarget = { kcal: i.kcal || null, p: i.protein || null, c: i.carbs || null, f: i.fat || null } })
    } else if (p.kind === 'adjust') {
      update(s => applyAdjustment(s, p.adj))
    }
    setApplied(true)
    ui().toast(t('Done'))
    onDone && onDone()
  }

  const label = {
    swap_days: t('Swap {0} and {1}', t(DAYN[(p.input || {}).day_a]), t(DAYN[(p.input || {}).day_b])),
    set_day: t('{0}: {1}', t(DAYN[(p.input || {}).day]), (p.input || {}).routine_name || ''),
    add_exercise: t('Add {0} to {1}', exOr((p.input || {}).exercise_id).n, (p.input || {}).routine_name || ''),
    set_calorie_target: t('Set target to {0} kcal', fmtNum((p.input || {}).kcal)),
    adjust: t('Drop target to {0} kcal', fmtNum(p.adj ? p.adj.to : 0)),
  }[p.kind] || t('Apply')

  return <div className="item" style={{ borderColor: applied ? 'var(--green)' : 'var(--acc)', marginTop: 8 }}>
    <span className="lrow-i" style={{ background: applied ? 'var(--green)' : 'var(--acc)' }}>
      <Icon name={applied ? 'check' : 'sparkles'} />
    </span>
    <div className="grow">
      <div className="tt">{label}</div>
      {p.why && <div className="ss">{p.why}</div>}
    </div>
    {!applied && <Button size="sm" variant="primary" onClick={apply}>{t('Apply')}</Button>}
  </div>
}

/* ============================ the chat ============================ */

const STARTERS = [
  'What should I focus on this week?',
  'Why has my progress stalled?',
  'I have 20 minutes and no equipment — what should I do?',
  'Is my plan actually balanced?',
]

function Coach({ close }) {
  const S = useStore(s => s.S)
  const [turns, setTurns] = useState([])       // [{ role, text, proposals }]
  const [history, setHistory] = useState([])   // the API's own message list
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const endRef = useRef(null)
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ block: 'end' }) }, [turns])

  if (!hasKey()) return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="lightbulb" style={{ color: 'var(--acc)' }} />{t('Ask the coach')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('The coach reads your real training — your plan, your sessions, your weight trend — and answers questions about it. It runs on your own Anthropic API key, like the food estimates, and the rest of openGym works exactly the same without it.')}
    </div>
    <Button variant="primary" icon="key" onClick={() => { close(); aiKeySheet() }}>{t('Add an API key')}</Button>
  </>

  const ask = async text => {
    const question = (text || q).trim()
    if (!question || busy) return
    setQ(''); setErr(null); setBusy(true)
    setTurns(x => [...x, { role: 'user', text: question }, { role: 'assistant', text: '', proposals: [] }])
    try {
      const res = await askCoach({
        S, history, question,
        onDelta: d => setTurns(x => {
          const copy = x.slice()
          const last = copy[copy.length - 1]
          copy[copy.length - 1] = { ...last, text: last.text + d }
          return copy
        }),
      })
      setHistory(res.history)
      setTurns(x => {
        const copy = x.slice()
        copy[copy.length - 1] = { role: 'assistant', text: res.text, proposals: res.proposals }
        return copy
      })
    } catch (e) {
      setErr(String(e.message || e))
      setTurns(x => x.slice(0, -1))
    }
    setBusy(false)
  }

  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="lightbulb" style={{ color: 'var(--acc)' }} />{t('Ask the coach')}</h3>

    {!turns.length && <>
      <div className="muted small" style={{ marginBottom: 10, lineHeight: 1.5 }}>
        {t('It can see your plan, your sessions and your weight trend. Anything it suggests changing arrives as a button you have to press.')}
      </div>
      <div className="list" style={{ marginBottom: 12 }}>
        {STARTERS.map(s => <div key={s} className="item tappable" style={{ cursor: 'pointer' }} onClick={() => ask(t(s))}>
          <div className="grow"><div className="ss" style={{ lineHeight: 1.4 }}>{t(s)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      </div>
    </>}

    <div style={{ maxHeight: '46vh', overflowY: 'auto', marginBottom: 12 }}>
      {turns.map((turn, i) => <div key={i} style={{ marginBottom: 12 }}>
        {turn.role === 'user'
          ? <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{turn.text}</div>
          : <div className="small" style={{ lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {turn.text || <span className="dim">{t('Thinking…')}</span>}
          </div>}
        {(turn.proposals || []).map(p => <Proposal key={p.id} p={p} />)}
      </div>)}
      <div ref={endRef} />
    </div>

    {err && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}

    <div className="row" style={{ gap: 8 }}>
      <TextField className="grow" value={q} placeholder={t('Ask anything about your training')}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') ask() }} />
      <Button variant="primary" icon="chevronRight" disabled={busy || !q.trim()} onClick={() => ask()} aria-label={t('Send')} />
    </div>
    <div className="small dim" style={{ marginTop: 10, lineHeight: 1.4 }}>
      {t('Runs on your own API key. It can be wrong — it is a reader of your data, not a clinician.')}
    </div>
  </>
}
export const coachSheet = () => ui().openSheet(close => <Coach close={close} />)

/* ============================ the week ============================ */

/**
 * The weekly review. The deterministic verdict shows immediately and always; the written
 * version replaces it when it arrives, and simply never arrives without a key — so this
 * sheet is useful to everybody and better for the people who opted in.
 */
function Review({ close }) {
  const S = useStore(s => s.S)
  const [text, setText] = useState(null)
  const [busy, setBusy] = useState(hasKey())
  const line = verdictLine(S)
  useEffect(() => {
    let live = true
    if (hasKey()) weeklyReview(S).then(r => { if (live) { setText(r); setBusy(false) } })
    return () => { live = false }
  }, [])

  return <>
    <h3>{t('Your week')}</h3>
    {!goalOf(S) && <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Set a goal and this becomes a weekly read on whether it is working.')}
    </div>}
    {line && <div className="card" style={{ marginBottom: 12 }}>
      <div className="small" style={{ lineHeight: 1.5 }}>{t(...line)}</div>
    </div>}
    {busy && <div className="muted small" style={{ marginBottom: 12 }}>{t('Writing your review…')}</div>}
    {text && <div className="small" style={{ lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{text}</div>}
    {!busy && !text && hasKey() && <div className="small dim" style={{ marginBottom: 12 }}>
      {t('The written review could not be fetched — the numbers above are still the numbers.')}
    </div>}
    <Button variant="primary" icon="lightbulb" onClick={() => { close(); coachSheet() }}>{t('Ask the coach')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Close')}</Button>
  </>
}
export const reviewSheet = () => ui().openSheet(close => <Review close={close} />)
