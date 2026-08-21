import { describe, it, expect } from 'vitest'
import { suggestEasyWeek, stalledCount, dismissEasyWeek } from './fatigue.js'
import { EXDB } from './exercises.js'
import { isoOf } from './format.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const LIFT2 = EXDB.filter(e => e.bp !== 'cardio' && e.eq !== 'body weight')[1].id

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d }
const wk = (n, extra = {}) => ({
  id: 'w' + n, d: isoOf(day(-n * 7)), start: day(-n * 7).getTime(),
  entries: [{ id: LIFT, target: { sets: 2, reps: 5, weight: 60, mode: 'reps' },
    sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }],
  ...extra,
})
// A missed session: both sets short of the 5-rep target.
const miss = (daysAgo, id = LIFT) => ({
  id: 'm' + id + daysAgo, d: isoOf(day(-daysAgo)), start: day(-daysAgo).getTime(),
  entries: [{ id, target: { sets: 2, reps: 5, weight: 60, mode: 'reps' },
    sets: [{ w: 60, r: 3, done: true }, { w: 60, r: 3, done: true }] }],
})

describe('suggestEasyWeek', () => {
  it('says nothing to a fresh or resting profile', () => {
    expect(suggestEasyWeek({ workouts: [], routines: [] }).suggest).toBe(false)
    expect(suggestEasyWeek(null).suggest).toBe(false)
  })

  it('a long unbroken streak earns the suggestion on its own', () => {
    const S = { routines: [], workouts: [8, 7, 6, 5, 4, 3, 2, 1, 0].map(n => wk(n)) }
    const f = suggestEasyWeek(S)
    expect(f.suggest).toBe(true)
    expect(f.reasons.some(r => String(r[0]).includes('straight weeks'))).toBe(true)
  })

  it('a shorter streak needs a second signal — concurrent stalls provide it', () => {
    const base = [6, 5, 4, 3, 2, 1].map(n => wk(n))
    const routines = [{ id: 'r', name: 'A', ex: [
      { id: LIFT, sets: 2, reps: 5, weight: 60, mode: 'reps' },
      { id: LIFT2, sets: 2, reps: 5, weight: 60, mode: 'reps' },
    ] }]
    // streak alone: no
    expect(suggestEasyWeek({ routines, workouts: base }).suggest).toBe(false)
    // both lifts missing their targets twice running: yes
    const S = { routines, workouts: [...base, miss(9), miss(8, LIFT2), miss(2), miss(1, LIFT2)] }
    expect(stalledCount(S)).toBeGreaterThanOrEqual(2)
    const f = suggestEasyWeek(S)
    expect(f.suggest).toBe(true)
    expect(f.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('holds its tongue during an easy week, right after one, and while snoozed', () => {
    const S = { routines: [], workouts: [8, 7, 6, 5, 4, 3, 2, 1, 0].map(n => wk(n)) }
    expect(suggestEasyWeek({ ...S, easyUntil: isoOf(day(3)) }).suggest).toBe(false)
    expect(suggestEasyWeek({ ...S, easyUntil: isoOf(day(-10)) }).suggest).toBe(false)
    const s2 = { ...S }
    dismissEasyWeek(s2)
    expect(suggestEasyWeek(s2).suggest).toBe(false)
  })
})
