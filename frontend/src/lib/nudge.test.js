import { describe, it, expect } from 'vitest'
import { nudgeLadder, nudgeSummary, nudgePreview, deferToday, grudgeDays, minsOf, LADDERS, DEF_NUDGE, NUDGE_ID_BASE, NUDGE_ID_MAX } from './nudge.js'
import { EXDB } from './exercises.js'
import { isoOf } from './format.js'

const PUSH = EXDB.find(e => e.bp === 'chest').id
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d }

// A clock on a known calendar day, so "the ladder starts at 17:30" is checkable without
// caring which real day the suite runs on.
const at = (offsetDays, hhmm) => {
  const d = day(offsetDays)
  const [h, m] = hhmm.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

const ROUTINE = { id: 'r1', name: 'Push day', emoji: '💪', ex: [{ id: PUSH, sets: 4, reps: 10, mode: 'reps' }] }

// Every weekday planned, so "tomorrow is a workout day" holds whatever day it is today.
const base = (over = {}) => ({
  routines: [ROUTINE],
  week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' },
  dayPlan: {}, workouts: [], active: null,
  nudge: { ...DEF_NUDGE, on: true },
  ...over,
})
const todayOnly = (S, now) => nudgeLadder(S, now).filter(n => n.iso === isoOf(new Date(now)))

describe('minsOf', () => {
  it('parses a time, and falls back rather than scheduling at NaN', () => {
    expect(minsOf('17:30', 0)).toBe(1050)
    expect(minsOf('00:00', 9)).toBe(0)
    expect(minsOf('', 7)).toBe(7)
    expect(minsOf('25:00', 7)).toBe(7)
    expect(minsOf(null, 7)).toBe(7)
  })
})

describe('nudgeLadder', () => {
  it('says nothing when it is switched off, or there is nothing to say', () => {
    expect(nudgeLadder(base({ nudge: { ...DEF_NUDGE, on: false } }), at(0, '16:00'))).toEqual([])
    expect(nudgeLadder(null, at(0, '16:00'))).toEqual([])
    expect(nudgeLadder(base({ week: {} }), at(0, '16:00'))).toEqual([])
    // A planned day whose routine has been deleted is not a day.
    expect(nudgeLadder(base({ routines: [] }), at(0, '16:00'))).toEqual([])
  })

  it('starts at the usual home time and climbs one rung an hour', () => {
    const list = todayOnly(base(), at(0, '16:00'))
    expect(list.length).toBe(LADDERS.push.length)
    expect(list.map(n => hhmm(n.at))).toEqual(['17:30', '18:30', '19:30', '20:30', '21:30'])
    expect(list.map(n => n.tier)).toEqual([0, 1, 2, 3, 4])
  })

  it('opens plan-aware and friendly, and ends blunt', () => {
    const list = todayOnly(base(), at(0, '16:00'))
    expect(list[0].body).toContain('Push day')
    expect(list[0].body).toMatch(/chest|shoulders|triceps/i)
    expect(list[0].body).not.toMatch(/skip/i)
    expect(list[list.length - 1].body).toMatch(/skip/i)
  })

  it('goes quiet at bedtime rather than nagging into the night', () => {
    const S = base({ nudge: { ...DEF_NUDGE, on: true, home: '21:00', quiet: '22:00' } })
    const list = todayOnly(S, at(0, '16:00'))
    expect(list.map(n => hhmm(n.at))).toEqual(['21:00', '21:30'])
  })

  it('compresses rather than losing its punchline — the last rung always gets said', () => {
    // Seven rungs will not fit hourly between 17:30 and 22:00, so they tighten to ~45 min
    // apiece. The alternative is a tone chosen for its ending that never reaches it.
    const list = todayOnly(base({ nudge: { ...DEF_NUDGE, on: true, tone: 'full' } }), at(0, '16:00'))
    expect(list.length).toBe(LADDERS.full.length)
    expect(hhmm(list[0].at)).toBe('17:30')
    expect(new Date(list[list.length - 1].at).getHours()).toBeLessThan(22)
    const gaps = list.slice(1).map((n, i) => (n.at - list[i].at) / 60000)
    gaps.forEach(g => { expect(g).toBeGreaterThanOrEqual(30); expect(g).toBeLessThanOrEqual(60) })
    expect(new Set(gaps).size).toBe(1)   // evenly spaced, not front- or back-loaded
  })

  it('never fires two rungs less than half an hour apart, however tight the evening', () => {
    const S = base({ nudge: { ...DEF_NUDGE, on: true, tone: 'full', home: '21:00', quiet: '22:00' } })
    const list = todayOnly(S, at(0, '16:00'))
    expect(list.map(n => hhmm(n.at))).toEqual(['21:00', '21:30'])
  })

  it('skips rungs already in the past — a ladder joined late starts where it is', () => {
    const list = todayOnly(base(), at(0, '19:00'))
    expect(list.map(n => hhmm(n.at))).toEqual(['19:30', '20:30', '21:30'])
    // Still the right messages: joining late does not restart the tone at friendly.
    expect(list.map(n => n.tier)).toEqual([2, 3, 4])
  })

  it('a logged workout silences the rest of the day', () => {
    const S = base({ workouts: [{ id: 'w', d: isoOf(day(0)), start: at(0, '10:00'), entries: [] }] })
    expect(todayOnly(S, at(0, '16:00'))).toEqual([])
    // ...and tomorrow is untouched.
    expect(nudgeLadder(S, at(0, '16:00')).length).toBeGreaterThan(0)
  })

  it('a workout in progress silences it too — no nagging mid-set', () => {
    const S = base({ active: { id: 'a', d: isoOf(day(0)), start: at(0, '17:00'), entries: [] } })
    expect(todayOnly(S, at(0, '16:00'))).toEqual([])
  })

  it('respects a day rescheduled to rest', () => {
    const S = base({ dayPlan: { [isoOf(day(0))]: 'rest' } })
    expect(todayOnly(S, at(0, '16:00'))).toEqual([])
  })

  it('covers a rolling week, one ladder a day, with unique ids in the reserved range', () => {
    const list = nudgeLadder(base(), at(0, '16:00'))
    expect(new Set(list.map(n => n.iso)).size).toBe(7)
    expect(new Set(list.map(n => n.id)).size).toBe(list.length)
    list.forEach(n => { expect(n.id).toBeGreaterThanOrEqual(NUDGE_ID_BASE); expect(n.id).toBeLessThanOrEqual(NUDGE_ID_MAX) })
  })

  it('a gentler tone also nags less — the rung count is the tone', () => {
    const of = tone => todayOnly(base({ nudge: { ...DEF_NUDGE, on: true, tone } }), at(0, '16:00'))
    expect(of('kind').length).toBe(3)
    expect(of('push').length).toBe(5)
    expect(of('full').length).toBe(7)
    // ...and only the tone that was asked for ever swears.
    const sweary = /fuck|shit|bloody|arse/i
    expect(of('kind').some(n => sweary.test(n.body))).toBe(false)
    expect(of('push').some(n => sweary.test(n.body))).toBe(false)
    expect(of('full').some(n => sweary.test(n.body))).toBe(true)
  })

  it('an unknown tone falls back rather than scheduling nothing', () => {
    expect(todayOnly(base({ nudge: { ...DEF_NUDGE, on: true, tone: 'wat' } }), at(0, '16:00')).length)
      .toBe(LADDERS.push.length)
  })

  it('"Not home" pushes the rest of the evening back an hour, and only that day', () => {
    const S = base()
    deferToday(S, isoOf(day(0)))
    expect(S.nudge.notHome).toEqual({ d: isoOf(day(0)), by: 1 })
    const list = todayOnly(S, at(0, '16:00'))
    expect(hhmm(list[0].at)).toBe('18:30')
    // Tomorrow starts from the usual time again — a late night is not a new routine.
    const tom = nudgeLadder(S, at(0, '16:00')).filter(n => n.iso === isoOf(day(1)))
    expect(hhmm(tom[0].at)).toBe('17:30')
    // Tapping again defers again, and bedtime still wins.
    deferToday(S, isoOf(day(0)))
    deferToday(S, isoOf(day(0)))
    const late = todayOnly(S, at(0, '16:00'))
    expect(hhmm(late.map(n => n.at)[0])).toBe('20:30')
    // What is left of the evening gets what fits, at the half-hour floor — never past bedtime.
    expect(late.map(n => hhmm(n.at))).toEqual(['20:30', '21:00', '21:30'])
  })

  it('deferring works from a profile that has never seen the nudge settings', () => {
    const S = { }
    deferToday(S, '2026-01-01')
    expect(S.nudge).toEqual({ ...DEF_NUDGE, notHome: { d: '2026-01-01', by: 1 } })
  })
})

describe('the grudge', () => {
  // Two weeks of ducking the same weekday, while otherwise training.
  const grudged = () => {
    const wd = day(0).getDay()
    const workouts = [3, 4, 10, 11].map(n => ({ id: 'w' + n, d: isoOf(day(-n)), start: day(-n).getTime(), entries: [] }))
      .filter(w => new Date(w.d + 'T12:00:00').getDay() !== wd)
    return base({
      workouts: [{ id: 'old', d: isoOf(day(-40)), start: day(-40).getTime(), entries: [] }, ...workouts]
        .sort((a, b) => a.d.localeCompare(b.d)),
      weekEdited: isoOf(day(-60)),
    })
  }

  it('a day ducked twice running is remembered', () => {
    expect(grudgeDays(grudged())).toContain(day(0).getDay())
    expect(grudgeDays(base())).toEqual([])
  })

  it('starts a tier in, says why, and therefore ends an hour earlier', () => {
    const S = grudged()
    const list = todayOnly(S, at(0, '16:00'))
    expect(list.length).toBe(LADDERS.push.length - 1)
    expect(list[0].tier).toBe(1)
    expect(list[0].body).toMatch(/Second .* running/)
    expect(list.map(n => hhmm(n.at))).toEqual(['17:30', '18:30', '19:30', '20:30'])
  })
})

describe('nudgePreview', () => {
  it('shows the harshest line the chosen tone has, about a session that is actually planned', () => {
    const p = nudgePreview(base({ nudge: { ...DEF_NUDGE, on: true, tone: 'full' } }))
    expect(p.body).toMatch(/fucking/)
    expect(nudgePreview(base()).body).toContain('Push day')
    expect(nudgePreview(base()).body).toBe(
      nudgeLadder(base(), at(0, '16:00')).filter(n => n.iso === isoOf(day(0))).pop().body)
  })

  it('has nothing to preview without a routine, and says so rather than inventing one', () => {
    expect(nudgePreview(base({ routines: [], week: {} }))).toBe(null)
    expect(nudgePreview(null)).toBe(null)
  })
})

describe('nudgeSummary', () => {
  it('is silent when the feature is, and honest about the rungs that fit before bedtime', () => {
    expect(nudgeSummary(base({ nudge: { ...DEF_NUDGE, on: false } }))).toBe(null)
    expect(nudgeSummary(base())).toContain('5 reminders')
    // One hour before bedtime cannot hold five rungs, and the sentence must not claim it does.
    expect(nudgeSummary(base({ nudge: { ...DEF_NUDGE, on: true, home: '21:00', quiet: '22:00' } }))).toContain('2 reminders')
    // And a window with no room at all admits it rather than promising nothing convincingly.
    expect(nudgeSummary(base({ nudge: { ...DEF_NUDGE, on: true, home: '22:00', quiet: '22:00' } })))
      .toMatch(/Nothing fits/)
  })
})
