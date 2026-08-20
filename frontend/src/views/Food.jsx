import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate, todayISO, isoOf, DAYS } from '../lib/format.js'
import {
  dayFood, dayTotals, totals, macroSplit, targetOf, remaining,
  MACROS, MACRO_NAME, SOURCES, isEstimate, avgKcal,
} from '../lib/food.js'
import { addFoodSheet, foodFormSheet, foodTargetSheet } from '../foodsheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// A day of eating: what went in, what it added up to, and how that sits against a target.
// Deliberately a day at a time rather than a running feed — the question a food log answers
// is "where am I today", and a scrolling history buries it.
export default function Food() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [iso, setIso] = useState(todayISO())

  const entries = dayFood(S, iso)
  const got = dayTotals(S, iso)
  const tgt = targetOf(S)
  const left = remaining(S, iso)
  const split = macroSplit(got)
  const isToday = iso === todayISO()

  const shift = n => {
    const d = new Date(iso + 'T12:00:00')
    d.setDate(d.getDate() + n)
    const next = isoOf(d)
    if (next <= todayISO()) setIso(next)      // no logging into the future
  }

  // The headline number, and how much of it is left. Without a target the total stands alone
  // rather than being drawn against an invented one.
  const pct = tgt && tgt.kcal ? Math.min(1, got.kcal / tgt.kcal) : 0
  const over = tgt && tgt.kcal && got.kcal > tgt.kcal

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}>
        <h1>{t('Food')}</h1>
        <div className="sub">{isToday ? t('Today') : fmtDate(iso, true)}</div>
      </div>
      <button className="iconbtn" onClick={foodTargetSheet} aria-label={t('Daily target')}><Icon name="target" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => shift(-1)} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{isToday ? t('Today') : fmtDate(iso, true)}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15, opacity: isToday ? 0.3 : 1 }}
          disabled={isToday} onClick={() => shift(1)} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <div className="big">{got.kcal} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
        {tgt && tgt.kcal > 0 && <span className="small" style={{ marginLeft: 'auto', color: over ? 'var(--yellow)' : 'var(--label-2)' }}>
          {over ? t('{0} over', left.kcal * -1) : t('{0} left', left.kcal)}
        </span>}
      </div>
      {tgt && tgt.kcal > 0 && <div className="wprog" style={{ marginTop: 8 }}>
        <i style={{ width: pct * 100 + '%', background: over ? 'var(--yellow)' : undefined }} />
      </div>}

      {/* Macros as their own rows: a stacked bar of three numbers is pretty and unreadable,
          and the useful comparison is each macro against its own target, not against the others. */}
      <div style={{ marginTop: 12 }}>
        {MACROS.map(k => {
          const target = tgt && tgt[k]
          const w = target ? Math.min(1, got[k] / target) : split[k]
          return <div key={k} className="mrow">
            <span className="nm">{t(MACRO_NAME[k])}</span>
            <span className="bar"><i style={{ width: Math.round(w * 100) + '%' }} /></span>
            <span className="v">{fmtNum(got[k])} g{target ? ` / ${target}` : ` · ${Math.round(split[k] * 100)}%`}</span>
          </div>
        })}
      </div>
      {!tgt && <div className="small dim" style={{ marginTop: 10 }}>
        {t('No daily target set — the bars show where your energy came from instead.')}
      </div>}
    </div>

    <div className="row" style={{ marginBottom: 12 }}>
      <Button variant="primary" icon="plus" onClick={() => addFoodSheet(iso)}>{t('Add food')}</Button>
    </div>

    {entries.length ? <div className="list">
      {entries.map(e => <div key={e.id} className="item" onClick={() => foodFormSheet({ existing: e, iso })}>
        <div className="grow">
          <div className="tt">{e.n}</div>
          <div className="ss">{[e.q, `${e.kcal} kcal`, `P ${fmtNum(e.p)} · C ${fmtNum(e.c)} · F ${fmtNum(e.f)}`].filter(Boolean).join(' · ')}</div>
        </div>
        {/* An AI number and a number off a packet must never look the same. */}
        {isEstimate(e) && <span className="tag" title={t('AI estimate')}><Icon name="sparkles" /></span>}
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div> : <div className="empty">
      <div className="ico"><Icon name="clipboard" /></div>
      {isToday ? t('Nothing logged yet today.') : t('Nothing logged on this day.')}
    </div>}

    {entries.length > 0 && <div className="small dim" style={{ margin: '12px 2px' }}>
      {t('Tap anything to correct or remove it.')}
    </div>}
  </div>
}
