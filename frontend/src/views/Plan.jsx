import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet, confirmSheet } from '../sheets.jsx'
import { useUI } from '../store/useUI.js'
import { planWizardSheet } from '../planner.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { weekAudit, adjacentOverlap, sessionMinutes, routineMuscles, repairFor, applyRepair } from '../lib/week.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'

// The wizard's coverage audit, running live on the plan as it is edited. A generated plan
// arrives clean; the moment it is changed by hand, this is what keeps it honest — same
// engine, same honest bar (scaled to kit and week size), no preview to scroll back to.
function WeekCheck({ S }) {
  const update = useStore(s => s.update)
  const audit = weekAudit(S)
  if (!audit) return null
  const overlaps = adjacentOverlap(S)
  const clean = !audit.light.length && !audit.missed.length
  const names = ms => ms.map(m => t(MUSCLE_NAME[m])).join(', ')
  // A diagnosis with the cure attached: tapping a gap offers the generator's own backfill —
  // the right movement, configured, into the right session — behind one confirm.
  const fix = m => {
    const rep = repairFor(S, m)
    if (!rep) { useUI.getState().toast(t('No good fix within your kit — add something by hand.')); return }
    confirmSheet({
      title: t('Close the gap?'),
      message: rep.kind === 'add'
        ? t('Add {0} ({1} sets) to {2}? You can tune or remove it there.', rep.name, rep.cfg.sets, rep.routine.name)
        : t('One more set of {0} in {1}?', rep.name, rep.routine.name),
      confirmText: rep.kind === 'add' ? t('Add it') : t('Add the set'),
      onConfirm: () => {
        update(s => applyRepair(s, rep))
        useUI.getState().toast(t('{0} added to {1}', rep.name, rep.routine.name))
      },
    })
  }
  return <div className="card" style={{ marginTop: 14 }}>
    <h2>{t('Week check')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('what this week hits')}</span></h2>
    <BodyMap load={audit.load} body={S.body} />
    <BodyMapLegend />
    {clean && <div className="small" style={{ color: 'var(--green)', marginTop: 8 }}>
      {t('Every muscle your kit can train gets enough work this week.')}
    </div>}
    {audit.missed.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 10 }}>{t('Not trained this week')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('tap one to fix it')}</span></h4>
      <div className="mchips">{audit.missed.map(m =>
        <span key={m} className="mchip miss tappable" style={{ cursor: 'pointer' }} onClick={() => fix(m)}>{t(MUSCLE_NAME[m])} +</span>)}</div>
    </>}
    {audit.light.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 10 }}>{t('Getting some work, but light')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('tap one to fix it')}</span></h4>
      <div className="mchips">{audit.light.map(m =>
        <span key={m} className="mchip tappable" style={{ cursor: 'pointer' }} onClick={() => fix(m)}>{t(MUSCLE_NAME[m])} +</span>)}</div>
    </>}
    {overlaps.map(o => <div key={o.day} className="small" style={{ color: 'var(--yellow)', marginTop: 10, lineHeight: 1.45 }}>
      {t('{0} and {1} both hit {2} hard, back to back — a rest day or a different session between them would recover better.',
        t(DAYN[o.day]), t(DAYN[o.next]), names(o.shared.slice(0, 3)))}
    </div>)}
    {audit.untrainable.length > 0 && <div className="small dim" style={{ marginTop: 10 }}>
      {t('Out of reach for your kit: {0}.', names(audit.untrainable))}
    </div>}
  </div>
}

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <div className="row" style={{ gap: 6 }}>
        <button className="iconbtn" onClick={planWizardSheet} aria-label={t('Build me a plan')} title={t('Build me a plan')}><Icon name="sparkles" /></button>
        <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
      </div>
    </div>
    <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
      <WeekCheck S={S} />
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div>
          {/* What it is, what it costs, what it hits — the three questions a routine row gets asked. */}
          <div className="ss">{exCount(r.ex.length)}{r.ex.length ? ` · ${t('≈ {0} min', sessionMinutes(r, S.restSec))}` : ''}
            {(() => { const m = routineMuscles(r, 3); return m.length ? ' · ' + m.map(x => t(MUSCLE_NAME[x])).join(', ') : '' })()}</div>
        </div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Let openGym build one, or start from scratch.')}</div>
        <Button variant="primary" icon="sparkles" onClick={planWizardSheet}>{t('Build me a plan')}</Button>
        <div style={{ height: 8 }} />
        <Button onClick={loadStarterPlan}>{t('Or pick a ready-made plan')}</Button>
      </>}
    </div></div>
  </>
}
