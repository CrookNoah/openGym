import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate, todayISO, isoOf, DAYS } from '../lib/format.js'
import {
  dayFood, dayTotals, totals, macroSplit, targetOf, remaining,
  MACROS, MACRO_NAME, SOURCES, isEstimate, avgKcal, copyDay,
} from '../lib/food.js'
import { addFoodSheet, foodFormSheet, foodTargetSheet, mealPlanSheet } from '../foodsheets.jsx'
import { mealPlanFor, mealsOf, SLOT_NAME } from '../lib/meals.js'
import { sessionBurn, kgOf } from '../lib/setup.js'
import { lastBW } from '../lib/history.js'
import { goalOf } from '../lib/goal.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// A day of eating: what went in, what it added up to, and how that sits against a target.
// Deliberately a day at a time rather than a running feed — the question a food log answers
// is "where am I today", and a scrolling history buries it.
export default function Food() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [iso, setIso] = useState(todayISO())

  const entries = dayFood(S, iso)
  const got = dayTotals(S, iso)
  const tgt = targetOf(S)
  const left = remaining(S, iso)
  const split = macroSplit(got)
  const isToday = iso === todayISO()
  const toastCopy = n => useUI.getState().toast(t('{0} items copied from yesterday', n))

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
        <h1>{t('Meals')}</h1>
        <div className="sub">{isToday ? t('Today') : fmtDate(iso, true)}</div>
      </div>
      <button className="iconbtn" onClick={mealPlanSheet} aria-label={t('Meal plan')} title={t('Meal plan')}><Icon name="list" /></button>
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
      {/* Whose number this is. A target with a goal behind it reads differently from one
          somebody typed into a settings screen and forgot. */}
      {(() => {
        const g = goalOf(S)
        if (!g || !tgt || !(tgt.kcal > 0) || !isToday) return null
        return <div className="small dim" style={{ marginTop: 8 }}>
          {over
            ? t('Over your goal target for today.')
            : t('{0} kcal still inside your goal target for today.', fmtNum(left.kcal))}
        </div>
      })()}
      {/* Calories out, as context only. The target's activity assumption already includes
          training — a burn that "earns" extra food is how tracking apps teach overeating. */}
      {(() => {
        const mins = S.workouts.filter(w => w.d === iso && w.end > w.start)
          .reduce((n, w) => n + Math.min(180, (w.end - w.start) / 60000), 0)
        const bwv = lastBW(S)
        if (!mins || !bwv) return null
        const burn = sessionBurn(mins, kgOf(bwv.w, S.unit))
        return <div className="small dim" style={{ marginTop: 8 }}>
          {t('Training burned roughly {0} kcal today — already assumed by your target, not an extra allowance.', burn)}
        </div>
      })()}

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

    {(() => {
      const row = e => <div key={e.id} className="item" onClick={() => foodFormSheet({ existing: e, iso })}>
        <div className="grow">
          <div className="tt">{e.n}</div>
          <div className="ss">{[e.q, `${e.kcal} kcal`, `P ${fmtNum(e.p)} · C ${fmtNum(e.c)} · F ${fmtNum(e.f)}`].filter(Boolean).join(' · ')}</div>
        </div>
        {/* An AI number and a number off a packet must never look the same. */}
        {isEstimate(e) && <span className="tag" title={t('AI estimate')}><Icon name="sparkles" /></span>}
        <Icon name="chevronRight" className="chev" />
      </div>
      const plan = mealPlanFor(S)
      // Without a calorie target the day stays one flat list — an unpriced plan is noise.
      if (!plan) return entries.length ? <div className="list">{entries.map(row)}</div>
        : <div className="empty">
          <div className="ico"><Icon name="clipboard" /></div>
          {isToday ? t('Nothing logged yet today.') : t('Nothing logged on this day.')}
        </div>
      const grouped = mealsOf(S, iso)
      return plan.map(meal => {
        const list = grouped[meal.key] || []
        const got = Math.round(list.reduce((n, e) => n + (Number(e.kcal) || 0), 0))
        return <div key={meal.key} style={{ marginBottom: 14 }}>
          <div className="row between" style={{ margin: '0 2px 6px' }}>
            <h4 className="sec" style={{ margin: 0 }}>{t(SLOT_NAME[meal.key])} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {meal.time}</span></h4>
            <span className="small" style={{ color: got > meal.kcal * 1.25 ? 'var(--yellow)' : 'var(--label-2)' }}>
              {got ? `${got} / ` : ''}≈ {meal.kcal} kcal{meal.p ? ` · ${meal.p} g` : ''}
            </span>
          </div>
          {list.length
            ? <div className="list">{list.map(row)}</div>
            : <div className="item tappable" style={{ cursor: 'pointer' }} onClick={() => addFoodSheet(iso)}>
              <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="plus" /></span>
              <div className="grow"><div className="ss" style={{ lineHeight: 1.4 }}>{meal.foods ? t(meal.foods) : t('Nothing logged yet — tap to add.')}</div></div>
            </div>}
        </div>
      })
    })()}

    {/* Most days are yesterday with different timestamps — one tap covers the common case,
        and every copied entry stays individually editable. */}
    {entries.length === 0 && (() => {
      const y = new Date(iso + 'T12:00:00'); y.setDate(y.getDate() - 1)
      const yIso = isoOf(y)
      const yEntries = dayFood(S, yIso)
      if (!yEntries.length) return null
      return <Button icon="reset" onClick={() => {
        let n = 0
        update(s => { n = copyDay(s, yIso, iso) })
        toastCopy(n)
      }}>{t('Copy yesterday ({0} items)', yEntries.length)}</Button>
    })()}

    {entries.length > 0 && <div className="small dim" style={{ margin: '12px 2px' }}>
      {t('Tap anything to correct or remove it.')}
    </div>}
  </div>
}
