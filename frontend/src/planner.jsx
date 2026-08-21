// The plan wizard: a few questions, then the week it built and why.
//
// The preview is the point. A generator that just writes routines into your plan is a black
// box you either trust or do not; one that shows you the muscle map, the weekly sets, the rest
// days with their reasoning and anything it could not cover is a generator you can argue with.
// Nothing is written until you say so.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { DAYS } from './lib/format.js'
import { exOr } from './lib/exercises.js'
import { MUSCLE_NAME } from './lib/muscles.js'
import { exLine } from './lib/history.js'
import { sessionMinutes } from './lib/week.js'
import {
  GOALS, LEVELS, INTENSITY, LENGTHS, AVOID, DEFAULT_ANSWERS, MIN_DAYS, MAX_DAYS,
  generatePlan, applyPlan, splitName,
} from './lib/planner.js'
import { gearSummary, gearChosen } from './lib/gear.js'
import { gearSheet, confirmSheet } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import { glyphOf } from './lib/glyphs.js'
import BodyMap, { BodyMapLegend } from './components/BodyMap.jsx'
import { Button, SelectRow, Row, Stepper } from './components/ui.jsx'

const ui = () => useUI.getState()
const update = (...a) => useStore.getState().update(...a)
const toast = m => ui().toast(m)

/* ============================ the questions ============================ */
function PlanWizard({ close }) {
  const st = useStore(s => s.S)
  const [a, setA] = useState(() => ({ ...DEFAULT_ANSWERS, ...(st.plannerAnswers || {}) }))
  const set = (k, v) => setA(x => ({ ...x, [k]: v }))

  const go = () => {
    // Remembered so "build me another" does not mean answering everything again.
    update(s => { s.plannerAnswers = { ...a } })
    close()
    planPreviewSheet(a)
  }

  return <>
    <h3>{t('Build me a plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Answer five questions and openGym picks the exercises, the sets and reps, the split and the rest days — then shows you what it hits before anything is saved.')}
    </div>

    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow icon="target" iconTint="var(--acc)" title={t('What are you after?')} sheetTitle={t('Your goal')}
        value={a.goal} onChange={v => set('goal', v)}
        options={GOALS.map(g => ({ value: g.key, label: t(g.name), subtitle: t(g.hint) }))} />
      <SelectRow icon="figureStrength" iconTint="var(--blue)" title={t('How much have you trained?')} sheetTitle={t('Experience')}
        value={a.level} onChange={v => set('level', v)}
        options={LEVELS.map(l => ({ value: l.key, label: t(l.name), subtitle: t(l.hint) }))} />
      <SelectRow icon="flame" iconTint="var(--orange)" title={t('How hard should it hit?')} sheetTitle={t('Intensity')}
        value={a.intensity} onChange={v => set('intensity', v)}
        options={INTENSITY.map(i => ({ value: i.key, label: t(i.name), subtitle: t(i.hint) }))} />
      <SelectRow icon="timer" iconTint="var(--purple)" title={t('How long per session?')} sheetTitle={t('Session length')}
        value={a.length} onChange={v => set('length', v)}
        options={LENGTHS.map(l => ({ value: l.key, label: t(l.name) }))} />
    </div>

    <div className="row cfgrow" style={{ marginBottom: 6 }}>
      <Stepper label={t('Days a week')} value={a.days} step={1} decimal={false}
        onChange={v => set('days', Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(v) || 3)))} />
    </div>
    <div className="small dim" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      {t('{0} days a week gives you a {1} split. openGym picks which days, and which are rest.', a.days, splitName(a.days))}
    </div>

    {/* Life has a schedule before training does. Ticked days constrain the placement; none
        ticked means any day works and openGym arranges the week itself. */}
    <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t('Days you can train')}</div>
    <div className="chips" style={{ marginBottom: 6 }}>
      {[1, 2, 3, 4, 5, 6, 0].map(d => {
        const on = (a.availableDays || []).includes(d)
        return <button key={d} className={'chip' + (on ? ' on' : '')} onClick={() => {
          const cur = a.availableDays || []
          set('availableDays', on ? cur.filter(x => x !== d) : [...cur, d])
        }}>{t(DAYS[d])}</button>
      })}
    </div>
    <div className="small dim" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {(a.availableDays || []).length
        ? ((a.availableDays || []).length < a.days
          ? t('Only {0} days ticked — the plan will train those and drop to a {1} split.', a.availableDays.length, splitName(a.availableDays.length))
          : t('Sessions go on the ticked days, spread as far apart as they allow.'))
        : t('None ticked — any day works, and openGym spaces the week itself.')}
    </div>

    {/* Not medical advice and it never pretends to be: the same substitution the generator
        does for missing kit, pointed at a cranky joint. Nothing ticked is the normal case. */}
    <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t('Anything to train around?')}</div>
    <div className="chips" style={{ marginBottom: 6 }}>
      {AVOID.map(j => {
        const on = (a.avoid || []).includes(j.key)
        return <button key={j.key} className={'chip' + (on ? ' on' : '')} onClick={() => {
          const cur = a.avoid || []
          set('avoid', on ? cur.filter(x => x !== j.key) : [...cur, j.key])
        }}>{t(j.name)}</button>
      })}
    </div>
    <div className="small dim" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {(a.avoid || []).length
        ? AVOID.filter(j => a.avoid.includes(j.key)).map(j => t(j.hint)).join(' ')
        : t('Tick a joint that complains and the plan trains the same muscles by another road.')}
    </div>

    {/* The kit decides which exercises exist at all, so it is worth confirming here rather
        than generating a plan around an assumption. */}
    <Row icon="wrench" iconTint="var(--teal)" title={t('Training with')} subtitle={gearSummary(st, t)}
      accessory="chevron" onClick={() => { close(); gearSheet(() => planWizardSheet()) }} />
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="sparkles" onClick={go}>{t('Build my plan')}</Button>
  </>
}
export const planWizardSheet = () => ui().openSheet(close => <PlanWizard close={close} />)

/* ============================ the preview ============================ */
function PlanPreview({ answers, close }) {
  const st = useStore(s => s.S)
  const [plan] = useState(() => generatePlan(st, answers))
  const [open, setOpen] = useState(0)
  const r = plan.report
  const hasPlan = (st.routines || []).length > 0

  const save = replace => {
    update(s => applyPlan(s, plan, { replace }))
    close()
    toast(replace ? t('Plan replaced') : t('Plan added'))
    nav('/plan')
  }
  const commit = () => {
    if (!hasPlan) return save(true)
    // Overwriting somebody's existing routines is not something to do on one tap.
    confirmSheet({
      title: t('You already have routines'),
      message: t('Replace your current plan with this one, or keep both?'),
      confirmText: t('Replace it'),
      cancelText: t('Keep both'),
      onConfirm: () => save(true),
      onCancel: () => save(false),
    })
  }

  const max = r.ranked.length ? r.load[r.ranked[0]] : 1

  return <>
    <h3>{t('Your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {r.splitName} · {t('{0} days a week', r.days)} · {t(r.goalName)} · {t(r.intensityName)}
    </div>

    {/* The week at a glance — training days lit, rest days not. */}
    <div className="card">
      <div className="week" style={{ marginBottom: 8 }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const rid = plan.week[d]
          const rt = plan.routines.find(x => x.id === rid)
          return <div key={d} className="wday">
            <div className="lbl">{t(DAYS[d])}</div>
            <div className="num" style={{ fontSize: 11, fontWeight: 500, opacity: rt ? 1 : 0.35 }}>
              {rt ? rt.name.replace('Full Body', 'Full').slice(0, 6) : t('Rest')}
            </div>
            <div className={'dot' + (rt ? ' plan' : '')} />
          </div>
        })}
      </div>
      <div className="small dim" style={{ lineHeight: 1.45 }}><Icon name="moon" style={{ fontSize: 12, marginRight: 5 }} />{t(r.restWhy)}</div>
    </div>

    {/* What it actually hits — the same diagram Stats uses, so the two agree. */}
    <div className="card">
      <h2>{t('What this hits')}</h2>
      <BodyMap load={r.load} body={st.body} />
      <BodyMapLegend />
      {r.ranked.slice(0, 6).map(m => <div key={m} className="mrow">
        <span className="nm">{t(MUSCLE_NAME[m])}</span>
        <span className="bar"><i style={{ width: Math.round(r.load[m] / max * 100) + '%' }} /></span>
        <span className="v">{t('{0} sets', Math.round(r.load[m] * 10) / 10)}</span>
      </div>)}
      {r.filled.length > 0 && <div className="small dim" style={{ marginTop: 10, lineHeight: 1.45 }}>
        <Icon name="checkCircle" style={{ fontSize: 12, marginRight: 5, color: 'var(--acc)' }} />
        {t('Checked its own coverage and added {0} to fill gaps: {1}.', r.filled.length,
          [...new Set(r.filled.map(f => f.name))].join(', '))}
      </div>}
      {r.gapNames.length > 0 && <div className="small" style={{ color: 'var(--yellow)', marginTop: 8, lineHeight: 1.45 }}>
        {t('Still light on {0} — another day or a longer session would fix that.', r.gapNames.join(', '))}
      </div>}
      {r.untrainableNames.length > 0 && <div className="small dim" style={{ marginTop: 8, lineHeight: 1.45 }}>
        {t('{0} need equipment you do not have, so nothing here trains them.', r.untrainableNames.join(' and '))}
      </div>}
    </div>

    <div className="tiles">
      <div className="tile"><div className="l">{t('Sets a week')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{r.totalSets}</div></div>
      <div className="tile"><div className="l">{t('Rest between sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{r.restSec}s</div></div>
    </div>
    <div className="small dim" style={{ margin: '-4px 2px 10px', lineHeight: 1.45 }}>
      {t('Aim to stop about {0} reps short of failure. Every exercise starts where your experience puts it and climbs from there.', r.rir)}
    </div>
    {(r.fromHistory > 0 || r.loadedCount > 0 || r.supersets > 0 || r.finisher || r.daysClamped || r.avoidedNames?.length > 0) && (
      <div className="small dim" style={{ margin: '0 2px 14px', lineHeight: 1.5 }}>
        {r.fromHistory > 0 && <div><Icon name="history" style={{ fontSize: 12, marginRight: 5 }} />{t('{0} movements start where your training history puts them, not at a questionnaire guess.', r.fromHistory)}</div>}
        {r.loadedCount > 0 && <div><Icon name="dumbbell" style={{ fontSize: 12, marginRight: 5 }} />{t('{0} lifts use your weights — they progress by load, so they need no rep ceiling.', r.loadedCount)}</div>}
        {r.supersets > 0 && <div><Icon name="link" style={{ fontSize: 12, marginRight: 5 }} />{t('{0} superset pairs — a press with a pull, back-to-back, because short rests are the point of this goal.', r.supersets)}</div>}
        {r.finisher && <div><Icon name="flame" style={{ fontSize: 12, marginRight: 5 }} />{t('Each session ends with a {0} finisher for conditioning.', r.finisher)}</div>}
        {r.daysClamped && <div><Icon name="calendar" style={{ fontSize: 12, marginRight: 5 }} />{t('You ticked fewer days than you asked for — the plan trains the days that exist.')}</div>}
        {r.avoidedNames?.length > 0 && <div><Icon name="shield" style={{ fontSize: 12, marginRight: 5 }} />{t('Programmed around: {0}. The same muscles are trained by other movements.', r.avoidedNames.map(n => t(n)).join(', '))}</div>}
      </div>
    )}

    <h4 className="sec">{t('The sessions')}</h4>
    <div className="list">
      {plan.routines.map((rt, i) => <div key={rt.id}>
        <div className="item" onClick={() => setOpen(open === i ? -1 : i)}>
          <span className="lrow-i"><Icon name={glyphOf(rt.emoji)} /></span>
          <div className="grow">
            <div className="tt">{rt.name}</div>
            {/* Priced with the rest the PLAN will install (r.restSec), not the profile's current
                setting — the strength goal prescribes 150 s rests, and quoting minutes at the
                old 90 s would undersell every session by a third. */}
            <div className="ss">{t('{0} exercises', rt.ex.length)} · {t('{0} sets', rt.ex.reduce((n, e) => n + e.sets, 0))} · {t('≈ {0} min', sessionMinutes(rt, r.restSec))}</div>
          </div>
          <Icon name={open === i ? 'chevronUp' : 'chevronDown'} className="chev" />
        </div>
        {open === i && <div style={{ padding: '2px 4px 10px' }}>
          {rt.ex.map((e, j) => <div key={j} className="row between small" style={{ padding: '5px 8px' }}>
            <span className="capitalize">{exOr(e.id).n}</span>
            <span className="dim">{exLine(e, st.unit)}</span>
          </div>)}
        </div>}
      </div>)}
    </div>

    <div style={{ height: 14 }} />
    <Button variant="primary" icon="check" onClick={commit}>{t('Use this plan')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="reset" onClick={() => { close(); planWizardSheet() }}>{t('Change my answers')}</Button>
  </>
}
export const planPreviewSheet = answers => ui().openSheet(close => <PlanPreview answers={answers} close={close} />)
