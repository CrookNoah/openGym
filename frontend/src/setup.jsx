// The first-run setup flow: four sheets that turn a blank install into a working app.
//
// Weight and where it is going, the kit you own, the week the generator builds for it,
// and a day of eating to hold it all up — chained so each step's answers feed the next
// (the plan is generated against the kit just chosen; the diet is computed from the weight,
// the goal weight and the training goal just picked). Numbers live in lib/setup.js; this
// file is only the conversation.
//
// The flow is stamped as seen the moment the welcome sheet answers — start or skip alike —
// and never reappears on its own. Abandoning it midway costs nothing: every step writes
// real state through the same sheets the rest of the app uses, so whatever was answered is
// kept, and Settings can run the whole thing again on demand.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { todayISO, fmtNum } from './lib/format.js'
import { needsSetup, dietPlanFor, sessionBurn, gearAdvice, kgOf } from './lib/setup.js'
import { DEMO } from './lib/demo.js'
import { gearSheet, WeightInput, startWeight } from './sheets.jsx'
import { planWizardSheet } from './planner.jsx'
import { sessionMinutes } from './lib/week.js'
import { MUSCLE_NAME } from './lib/muscles.js'
import Icon from './components/Icon.jsx'
import { Button, Row, Segmented } from './components/ui.jsx'
import { MacroFields } from './foodsheets.jsx'
import { DIET_STYLES, DEF_MEALS } from './lib/meals.js'
import { SelectRow } from './components/ui.jsx'

const ui = () => useUI.getState()
const update = (...a) => useStore.getState().update(...a)
const S = () => useStore.getState().S

/* ============================ entry ============================ */

let offered = false
/** Called once the shell is up and someone is signed in (or a guest). */
export function maybeStartSetup() {
  if (offered || DEMO) return
  if (!needsSetup(S())) return
  offered = true
  welcomeSheet()
}

/** The Settings re-run: straight past the welcome, no stamp games. */
export const runSetup = () => weightSheet()

/* ============================ welcome ============================ */

function Welcome({ close }) {
  const begin = () => { update(s => { s.setupDone = todayISO() }); close(); weightSheet() }
  const skip = () => { update(s => { s.setupDone = todayISO() }); close() }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="sparkles" style={{ color: 'var(--acc)' }} />{t('Welcome to openGym')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Two minutes of questions and the app is set up around you — not the other way round.')}
    </div>
    <div className="sect-b" style={{ marginBottom: 14 }}>
      <Row icon="scale" iconTint="var(--yellow)" title={t('Your weight, and where you want it')} />
      <Row icon="dumbbell" iconTint="var(--blue)" title={t('What equipment you own')} subtitle={t('Everything is filtered to what you can actually train.')} />
      <Row icon="calendar" iconTint="var(--acc)" title={t('A weekly plan built for your goal')} subtitle={t('You see what it hits before anything is saved.')} />
      <Row icon="flame" iconTint="var(--orange)" title={t('What to eat for it')} subtitle={t('Calories and macros to match, plus what your kit is missing.')} />
    </div>
    <Button variant="primary" icon="sparkles" onClick={begin}>{t('Set me up')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={skip}>{t('I’ll explore on my own')}</Button>
  </>
}
const welcomeSheet = () => ui().openSheet(close => <Welcome close={close} />)

/* ============================ weight & goal weight ============================ */

function WeightStep({ close }) {
  const st = useStore(s => s.S)
  const bw = (st.bodyweight || []).slice(-1)[0]
  const [unit, setUnit] = useState(st.unit || 'lb')
  const [w, setW] = useState(bw ? bw.w : startWeight(st.unit || 'lb'))
  const [dir, setDir] = useState(() => (st.targetW && bw ? (st.targetW > bw.w ? 'gain' : 'lose') : 'hold'))
  const [tgt, setTgt] = useState(st.targetW || null)
  // Switching units relabels the dials, same as everywhere else in the app — numbers are
  // never converted, so flipping mid-thought means re-reading the dial, not maths.
  const pick = u => { setUnit(u); if (!bw) { setW(startWeight(u)); setTgt(null) } }
  const next = () => {
    const n = Math.round((w || 0) * 10) / 10
    if (!(n > 0)) { ui().toast(t('Enter a valid weight')); return }
    const goal = dir === 'hold' ? null : Math.round((tgt || n) * 10) / 10
    update(s => {
      s.unit = unit
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
      s.targetW = goal && Math.abs(goal - n) >= (unit === 'lb' ? 1 : 0.5) ? goal : null
    })
    close()
    gearSheet(() => planWizardSheet(() => dietSheet()))
  }
  return <>
    <h3>{t('Where is your weight going?')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {t('Your first weigh-in — the goal line on the chart, the diet numbers and the volume estimates all start here.')}
    </div>
    <div className="row" style={{ justifyContent: 'center', marginBottom: 6 }}>
      <Segmented className="seg-inline" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={unit} onChange={pick} />
    </div>
    <WeightInput value={w} setValue={setW} unit={unit} />
    <h4 className="sec" style={{ marginTop: 14 }}>{t('And the goal?')}</h4>
    <Segmented value={dir} onChange={v => { setDir(v); if (v !== 'hold' && !tgt) setTgt(Math.round(w + (v === 'gain' ? 1 : -1) * (unit === 'lb' ? 10 : 5))) }}
      options={[{ value: 'lose', label: t('Lose weight') }, { value: 'hold', label: t('Stay here') }, { value: 'gain', label: t('Gain weight') }]} />
    {dir !== 'hold' && <>
      <div style={{ height: 10 }} />
      <WeightInput value={tgt || w} setValue={setTgt} unit={unit} />
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={next}>{t('Next: your equipment')}</Button>
  </>
}
const weightSheet = () => ui().openSheet(close => <WeightStep close={close} />)

/* ============================ diet ============================ */

const DIR_LINE = {
  lose: 'Eating about {0} kcal a day should lose roughly half a kilo a week without costing muscle.',
  gain: 'Eating about {0} kcal a day should gain slowly enough that most of it is muscle.',
  hold: 'About {0} kcal a day should hold your weight where it is.',
}

function DietStep({ close }) {
  const st = useStore(s => s.S)
  const goal = (st.plannerAnswers || {}).goal
  const [plan] = useState(() => dietPlanFor(st, goal))
  const [v, setV] = useState(() => (plan ? { kcal: plan.kcal, p: plan.p, c: plan.c, f: plan.f } : { kcal: 0, p: 0, c: 0, f: 0 }))
  const [styleKey, setStyleKey] = useState(() => (st.meals || DEF_MEALS).style || 'balanced')
  // No weigh-in means nothing honest to compute — every number is per-kilo. The flow always
  // collects one first, so this is belt and braces for a re-run that skipped the scale.
  if (!plan) return <>
    <h3>{t('What to eat for it')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Log a weigh-in first — the diet numbers are computed from your body weight.')}</div>
    <Button variant="primary" onClick={() => { close(); adviceSheet() }}>{t('Skip for now')}</Button>
  </>
  // What a session of the new plan burns, said as context — the maintenance estimate
  // already assumes the training happens, so this is never added on top.
  const kg = kgOf(((st.bodyweight || []).slice(-1)[0] || {}).w || 0, st.unit)
  const scheduled = Object.values(st.week || {}).map(id => (st.routines || []).find(r => r.id === id)).filter(Boolean)
  const mins = scheduled.length ? Math.round(scheduled.reduce((n, r) => n + sessionMinutes(r, st.restSec), 0) / scheduled.length) : 0
  const burn = mins ? sessionBurn(mins, kg) : 0
  const save = () => {
    const any = v.kcal > 0 || v.p > 0 || v.c > 0 || v.f > 0
    update(s => {
      s.foodTarget = any ? { ...v } : null
      s.meals = { ...DEF_MEALS, ...(s.meals || {}), style: styleKey }
    })
    close()
    ui().toast(any ? t('Daily target set — the Meals tab tracks against it') : t('Target removed'))
    adviceSheet()
  }
  return <>
    <h3>{t('What to eat for it')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t(DIR_LINE[plan.dir], fmtNum(plan.kcal))}
      {plan.weeks ? ' ' + t('At that pace your goal weight is roughly {0} weeks out.', plan.weeks) : ''}
      {plan.floored ? ' ' + t('(Held above a floor — cutting faster than this costs the muscle you are training for.)') : ''}
    </div>
    <MacroFields v={v} setV={setV} />
    {/* How the day carries those numbers: the eating style splits the target into meals on
        the Meals tab, with mealtimes and (on the phone) reminders to log each one. */}
    <SelectRow icon="list" iconTint="var(--acc)" title={t('Eating style')} sheetTitle={t('Eating style')}
      value={styleKey} onChange={setStyleKey}
      options={DIET_STYLES.map(d => ({ value: d.key, label: t(d.name), subtitle: t(d.hint) }))} />
    <div style={{ height: 10 }} />
    <div className="small dim" style={{ lineHeight: 1.45, marginBottom: 14 }}>
      {t('Maintenance estimate: about {0} kcal, from body weight alone — the app knows nothing else about you, so treat it as a starting point: watch the weekly weigh-in trend and adjust by 150–200 kcal if it moves the wrong way.', fmtNum(plan.maintenance))}
      {burn ? ' ' + t('A session of your new plan is roughly {0} kcal of that.', fmtNum(burn)) : ''}
    </div>
    <Button variant="primary" icon="check" onClick={save}>{t('Set these targets')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); adviceSheet() }}>{t('No targets for now')}</Button>
  </>
}
const dietSheet = () => ui().openSheet(close => <DietStep close={close} />)

/* ============================ worth buying ============================ */

function AdviceStep({ close }) {
  const st = useStore(s => s.S)
  const picks = gearAdvice(st, st.plannerAnswers || {})
  const names = ms => ms.slice(0, 3).map(m => t(MUSCLE_NAME[m])).join(', ')
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('You’re set')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Your plan is on the Plan tab, today’s session is on Home, and the Meals tab tracks the day against your targets.')}
    </div>
    {picks.length > 0 && <>
      <h4 className="sec">{t('Worth buying, when you can')}</h4>
      <div className="small dim" style={{ margin: '2px 2px 8px', lineHeight: 1.45 }}>
        {t('Judged by what each one unlocks for your goal with the kit you have — tick it in Settings → Equipment when it arrives and openGym folds it into the plan.')}
      </div>
      <div className="sect-b" style={{ marginBottom: 14 }}>
        {picks.map(p => <Row key={p.key} icon="dumbbell" iconTint="var(--acc)" title={t(p.name)}
          subtitle={t(p.why)
            + (p.muscles.length ? ' ' + t('Reaches: {0}.', names(p.muscles)) : '')
            + (p.exN > 0 ? ' ' + t('Unlocks {0} exercises.', p.exN) : '')} />)}
      </div>
    </>}
    <Button variant="primary" onClick={close}>{t('Let’s train')}</Button>
  </>
}
const adviceSheet = () => ui().openSheet(close => <AdviceStep close={close} />)
