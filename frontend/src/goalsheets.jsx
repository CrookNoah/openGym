// The goal, on screen: the card that sits at the top of Home while one is live, the sheet
// that starts or edits it, and the check-in that reads the week back to you.
//
// The engine (lib/goal.js) decides everything; this file only puts sentences and buttons on
// it. Two things it is careful about, both of them the difference between a goal people keep
// and a goal people mute:
//
//   · The headline number is the *trend*, with the morning's raw reading demoted to a
//     footnote. A card that leads with the scale is a card that celebrates a dry morning and
//     panics after a salty dinner.
//   · The adjustment is offered with its reasoning attached, and half the time the reasoning
//     is "the target is fine, the week wasn't". Saying so is the whole point.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { fmtNum, fmtDate, todayISO } from './lib/format.js'
import {
  goalOf, goalProgress, paceVerdict, verdictLine, proposeAdjustment, applyAdjustment,
  recommendGoal, startGoal, clearGoal, trendWeight, daysSinceWeighIn, GOAL_SHARES, DEF_GOAL_TIME,
} from './lib/goal.js'
import { bwSheet, WeightInput } from './sheets.jsx'
import { coachSheet, reviewSheet } from './coachsheets.jsx'
import Icon from './components/Icon.jsx'
import { Button, Row, Segmented } from './components/ui.jsx'

const ui = () => useUI.getState()
const update = (...a) => useStore.getState().update(...a)

const KIND_NAME = { lose: 'Lose weight', gain: 'Gain weight', maintain: 'Stay here' }
const VERDICT_TINT = {
  early: 'var(--label-2)', ontrack: 'var(--green)', ahead: 'var(--green)',
  behind: 'var(--yellow)', stalled: 'var(--yellow)', wrong: 'var(--red)', done: 'var(--acc)',
}

/* ============================ the card ============================ */

/** The pinned Home card. Null when there is no goal — nothing to nag about. */
export function GoalCard() {
  const S = useStore(s => s.S)
  const g = goalOf(S)
  if (!g) return null
  const p = goalProgress(S)
  const v = paceVerdict(S)
  const line = verdictLine(S)
  const adj = proposeAdjustment(S)
  const stale = daysSinceWeighIn(S)
  const unit = S.unit || 'lb'
  const pct = p ? Math.max(0, p.pct) : 0

  return <div className="card" style={{ borderColor: VERDICT_TINT[v ? v.state : 'early'] }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t(KIND_NAME[g.kind])}</h2>
      <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 14 }}
        aria-label={t('Edit goal')} onClick={goalSetupSheet}><Icon name="gear" /></button>
    </div>

    {/* The trend leads; the morning's reading is a footnote, on purpose. */}
    {p ? <>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <div className="big">{fmtNum(p.now)} <span className="muted" style={{ fontSize: '1rem' }}>{unit}</span></div>
        {g.targetW != null && <span className="small" style={{ marginLeft: 'auto', color: 'var(--label-2)' }}>
          {t('{0} {1} to go', fmtNum(p.toGo), unit)}
        </span>}
      </div>
      <div className="small dim" style={{ marginTop: 2 }}>
        {t('trend — last weigh-in {0} {1}', fmtNum((S.bodyweight.slice(-1)[0] || {}).w), unit)}
      </div>
      {g.targetW != null && <div className="wprog" style={{ marginTop: 10 }}>
        <i style={{ width: Math.round(pct * 100) + '%' }} />
      </div>}
      <div className="small" style={{ marginTop: 8, lineHeight: 1.45, color: VERDICT_TINT[v.state] }}>
        {line ? t(...line) : null}
      </div>
      {p.etaWeeks != null && <div className="small dim" style={{ marginTop: 4 }}>
        {t('At this pace, about {0} weeks to go.', p.etaWeeks)}
      </div>}
    </> : <div className="muted small">{t('Log a weigh-in and this starts tracking.')}</div>}

    {/* What to do next, in one row. A weigh-in beats everything: without data the rest of
        this card is guesswork wearing a progress bar. */}
    <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      {stale >= 1 && <Button variant="primary" size="sm" icon="scale" onClick={() => bwSheet()}>{t('Weigh in')}</Button>}
      <Button size="sm" icon="sparkles" onClick={() => reviewSheet()}>{t('My week')}</Button>
      <Button size="sm" icon="lightbulb" onClick={() => coachSheet()}>{t('Ask the coach')}</Button>
    </div>

    {adj && <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--sep)' }}>
      <AdjustmentRow adj={adj} />
    </div>}
  </div>
}

/**
 * The offer, or the diagnosis instead of one. Three of the four outcomes here change no
 * number at all, which is the honest shape: a flat week is usually a week that did not
 * happen rather than a target that is wrong.
 */
function AdjustmentRow({ adj }) {
  const S = useStore(s => s.S)
  if (adj.kind === 'log') return <div className="small" style={{ lineHeight: 1.45 }}>
    <Icon name="info" style={{ marginRight: 6, color: 'var(--label-3)' }} />
    {t('The trend has stalled, but only {0} days of food were logged — that is not enough to tell whether the plan or the week is the problem. Log a full week and ask again.', adj.loggedDays)}
  </div>
  if (adj.kind === 'eat') return <div className="small" style={{ lineHeight: 1.45 }}>
    <Icon name="info" style={{ marginRight: 6, color: 'var(--yellow)' }} />
    {t('Stalled — and the log says you averaged {0} kcal against a target of {1}. The target is not the problem; a smaller one would not be either.', fmtNum(adj.avgKcal), fmtNum(adj.target))}
  </div>
  if (adj.kind === 'train') return <div className="small" style={{ lineHeight: 1.45 }}>
    <Icon name="info" style={{ marginRight: 6, color: 'var(--yellow)' }} />
    {t('Stalled — you ate to plan but trained {0} of {1} planned sessions. That is the gap.', adj.done, adj.planned)}
  </div>
  if (adj.kind === 'floor') return <div className="small" style={{ lineHeight: 1.45 }}>
    <Icon name="info" style={{ marginRight: 6, color: 'var(--yellow)' }} />
    {t('Stalled, but your target is already as low as this app will take it. Add a session, or take a fortnight at maintenance and start again — cutting further costs muscle.')}
  </div>
  return <>
    <div className="small" style={{ lineHeight: 1.45, marginBottom: 8 }}>
      {t('You followed the plan and the trend is still flat. Drop the daily target from {0} to {1} kcal?', fmtNum(adj.from), fmtNum(adj.to))}
    </div>
    <Button variant="primary" size="sm" icon="check" onClick={() => {
      update(s => applyAdjustment(s, adj))
      ui().toast(t('Target now {0} kcal', fmtNum(adj.to)))
    }}>{t('Do it')}</Button>
  </>
}

/* ============================ starting one ============================ */

function GoalSetup({ close }) {
  const S = useStore(s => s.S)
  const cur = goalOf(S)
  const unit = S.unit || 'lb'
  const bw = trendWeight(S) || ((S.bodyweight || []).slice(-1)[0] || {}).w
  const [kind, setKind] = useState(cur ? cur.kind : 'lose')
  const [share, setShare] = useState(0.1)
  // The recommendation recomputes as you change your mind; the target stays editable, so
  // "10% of body weight" is a starting point rather than a rule.
  const rec = recommendGoal(S, kind, share)
  const [targetW, setTargetW] = useState(cur ? cur.targetW : (rec ? rec.targetW : null))
  const [rate, setRate] = useState(cur ? cur.rate : (rec ? rec.rate : 1))
  const [time, setTime] = useState((cur && cur.weighTime) || DEF_GOAL_TIME)
  const pick = k => {
    setKind(k)
    const r = recommendGoal(S, k, share)
    if (r) { setTargetW(r.targetW); setRate(r.rate) }
  }
  const pickShare = v => {
    setShare(v)
    const r = recommendGoal(S, kind, v)
    if (r) { setTargetW(r.targetW); setRate(r.rate) }
  }
  if (!(bw > 0)) return <>
    <h3>{t('Set a goal')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Log a weigh-in first — a goal needs somewhere to start from.')}</div>
    <Button variant="primary" onClick={() => { close(); bwSheet() }}>{t('Log a weigh-in')}</Button>
  </>

  const weeks = rate > 0 && targetW != null ? Math.ceil(Math.abs(targetW - bw) / rate) : null
  const save = () => {
    update(s => startGoal(s, { kind, startW: bw, targetW: kind === 'maintain' ? null : targetW, rate: kind === 'maintain' ? 0 : rate }))
    update(s => { s.goal = { ...s.goal, weighTime: time } })
    close()
    ui().toast(t('Goal set — it starts from today'))
  }
  return <>
    <h3>{cur ? t('Your goal') : t('Set a goal')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t('openGym measures this against the trend in your weigh-ins, not the number on any one morning — so a salty dinner never counts as a bad week.')}
    </div>

    <Segmented value={kind} onChange={pick}
      options={[{ value: 'lose', label: t('Lose weight') }, { value: 'maintain', label: t('Stay here') }, { value: 'gain', label: t('Gain weight') }]} />

    {kind !== 'maintain' && <>
      <h4 className="sec" style={{ marginTop: 14 }}>{t('How much?')}</h4>
      <Segmented value={share} onChange={pickShare}
        options={GOAL_SHARES.map(x => ({ value: x, label: `${Math.round(x * 100)}%` }))} />
      <div className="small dim" style={{ margin: '6px 2px 10px', lineHeight: 1.45 }}>
        {t('A tenth of your body weight is the usual first target — enough to matter, few enough weeks to stay believable. Adjust the number below to anything you like.')}
      </div>
      <WeightInput value={targetW || bw} setValue={setTargetW} unit={unit} />

      <h4 className="sec" style={{ marginTop: 14 }}>{t('How fast?')}</h4>
      <div className="sect-b" style={{ marginBottom: 10 }}>
        <Row icon="chartLine" iconTint="var(--acc)" title={t('{0} {1} a week', fmtNum(rate), unit)}
          subtitle={weeks ? t('About {0} weeks at that pace.', weeks) : null}>
          <span className="row" style={{ gap: 4 }}>
            <button className="iconbtn" style={{ width: 30, height: 30 }} aria-label={t('Slower')}
              onClick={() => setRate(r => Math.max(0.1, Math.round((r - 0.1) * 10) / 10))}><Icon name="minus" /></button>
            <button className="iconbtn" style={{ width: 30, height: 30 }} aria-label={t('Faster')}
              onClick={() => setRate(r => Math.round((r + 0.1) * 10) / 10)}><Icon name="plus" /></button>
          </span>
        </Row>
      </div>
      {bw > 0 && rate / bw > 0.011 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10, lineHeight: 1.45 }}>
        {t('That is faster than about 1% of your body weight a week. Past that, what you lose stops being mostly fat.')}
      </div>}
    </>}

    <div className="sect-b" style={{ marginBottom: 12 }}>
      <Row icon="clock" iconTint="var(--purple)" title={t('Morning weigh-in reminder')}
        subtitle={t('Same time, before breakfast — a trend needs readings taken the same way.')}>
        <input type="time" className="timef" value={time} onChange={e => setTime(e.target.value)} />
      </Row>
    </div>

    <Button variant="primary" icon="target" onClick={save}>{cur ? t('Update the goal') : t('Start')}</Button>
    {cur && <><div style={{ height: 8 }} />
      <Button variant="danger" onClick={() => { update(s => clearGoal(s)); close(); ui().toast(t('Goal cleared')) }}>
        {t('Clear the goal')}</Button></>}
  </>
}
export const goalSetupSheet = () => ui().openSheet(close => <GoalSetup close={close} />)
