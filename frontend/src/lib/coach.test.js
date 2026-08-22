import { describe, it, expect } from 'vitest'
import { coachContext, runTool, WRITE_TOOLS } from './coach.js'
import { EXDB } from './exercises.js'
import { isoOf } from './format.js'

const NOW = new Date(); NOW.setHours(12, 0, 0, 0)
const now = NOW.getTime()
const day = n => { const d = new Date(now); d.setDate(d.getDate() + n); return d }
const PUSH = EXDB.find(e => e.bp === 'chest' && e.eq === 'body weight').id

const base = (over = {}) => ({
  unit: 'lb', gear: [], restSec: 90,
  routines: [{ id: 'r1', name: 'Upper', ex: [{ id: PUSH, sets: 3, reps: 10, mode: 'reps', bodyweight: true }] }],
  week: { 1: 'r1', 4: 'r1' }, dayPlan: {},
  bodyweight: [{ d: isoOf(day(-2)), w: 200, t: day(-2).getTime() }, { d: isoOf(day(0)), w: 199, t: now }],
  workouts: [{ id: 'w1', d: isoOf(day(-2)), start: day(-2).getTime(), end: day(-2).getTime() + 2400000, name: 'Upper',
    entries: [{ id: PUSH, target: { sets: 3, reps: 10, mode: 'reps', bodyweight: true },
      sets: [{ w: 0, r: 10, done: true }, { w: 0, r: 9, done: true }] }] }],
  food: [], foodTarget: { kcal: 2000, p: 150, c: 200, f: 60 },
  goal: { kind: 'lose', startW: 205, startD: isoOf(day(-28)), targetW: 185, rate: 1,
    baseKcal: 2000, adjustments: [], weighTime: '07:30', dismissed: null },
  ...over,
})

describe('coachContext', () => {
  it('carries the shape of the training without carrying the whole log', () => {
    const c = coachContext(base(), now)
    expect(c.unit).toBe('lb')
    expect(c.goal.kind).toBe('lose')
    expect(c.goal.targetWeight).toBe(185)
    expect(c.training.week.length).toBe(7)
    expect(c.training.week.find(d => d.day === 'Monday').session).toBe('Upper')
    expect(c.recentSessions.length).toBe(1)
    expect(c.diet.target.kcal).toBe(2000)
    // Bounded: a long history must not blow the context up.
    const big = base({ workouts: Array.from({ length: 200 }, (_, i) => ({ id: 'w' + i, d: isoOf(day(-i)), entries: [] })) })
    expect(coachContext(big, now).recentSessions.length).toBeLessThanOrEqual(6)
  })

  it('reports the trend weight, not just the last morning', () => {
    const c = coachContext(base(), now)
    expect(c.bodyweight.latest).toBe(199)
    expect(c.bodyweight.trend).toBeGreaterThan(199)   // smoothed, so it lags the drop
  })

  it('survives a profile with nothing in it', () => {
    const c = coachContext({ unit: 'kg' }, now)
    expect(c.goal).toBe(null)
    expect(c.diet).toBe(null)
    expect(c.recentSessions).toEqual([])
    expect(JSON.stringify(c).length).toBeGreaterThan(0)
  })
})

describe('the tool layer', () => {
  it('search only ever returns exercises that exist and the kit can reach', () => {
    const { result } = runTool(base(), 'search_exercises', { query: 'push up', limit: 5 })
    expect(result.exercises.length).toBeGreaterThan(0)
    result.exercises.forEach(e => {
      expect(EXDB.some(x => x.id === e.id)).toBe(true)
      // gear: [] is floor-only, so nothing needing kit may come back.
      expect(e.equipment === 'body weight' || e.equipment == null).toBe(true)
    })
  })

  it('search comes back empty rather than inventing something', () => {
    const { result } = runTool(base(), 'search_exercises', { query: 'zzzznotathing', limit: 5 })
    expect(result.exercises).toEqual([])
  })

  it('history reads the real log, and says so when there is none', () => {
    const { result } = runTool(base(), 'get_exercise_history', { exercise_id: PUSH, sessions: 5 })
    expect(result.sessions.length).toBe(1)
    expect(result.sessions[0].sets.length).toBe(2)
    const none = runTool(base(), 'get_exercise_history', { exercise_id: '9999', sessions: 5 })
    expect(none.result.note).toMatch(/No logged sessions/)
  })

  it('NO write tool executes — every one comes back as a proposal', () => {
    const S = base()
    const before = JSON.stringify(S)
    WRITE_TOOLS.filter(n => n !== 'take_calorie_adjustment').forEach(name => {
      const { result, proposal } = runTool(S, name, { why: 'because' })
      expect(proposal).not.toBe(null)
      expect(proposal.kind).toBe(name)
      // And the model is told plainly that nothing happened.
      expect(result.note).toMatch(/NOT been applied/)
    })
    expect(JSON.stringify(S)).toBe(before)   // state untouched
  })

  it('the calorie adjustment defers to the app\'s own engine rather than a made-up number', () => {
    // Nothing stalled — the engine declines, and the model is told not to invent one.
    const { result, proposal } = runTool(base(), 'take_calorie_adjustment', {})
    expect(result.proposed).toBe(false)
    expect(proposal).toBe(null)
    expect(result.note).toMatch(/rather than proposing a number yourself/)
  })

  it('a genuinely stalled goal gets the engine\'s step, floor and all', () => {
    const flat = Array.from({ length: 21 }, (_, i) => ({ d: isoOf(day(-i)), w: 200, t: day(-i).getTime() }))
    const meals = Array.from({ length: 6 }, (_, i) =>
      ({ id: 'f' + i, d: isoOf(day(-(i + 1))), t: day(-(i + 1)).getTime(), n: 'x', kcal: 2000, p: 0, c: 0, f: 0 }))
    // ...and the sessions were actually done, so "you skipped training" is not the answer.
    const sessions = []
    for (let k = 1; k <= 7; k++) {
      const d = day(-k)
      if (d.getDay() === 1 || d.getDay() === 4) sessions.push({ id: 'ws' + k, d: isoOf(d), entries: [] })
    }
    const { result, proposal } = runTool(base({ bodyweight: flat, food: meals, workouts: sessions }), 'take_calorie_adjustment', {})
    expect(result.proposed).toBe(true)
    expect(proposal.kind).toBe('adjust')
    expect(proposal.adj.to).toBe(1850)
  })

  it('an unknown tool is an error, not a silent success', () => {
    expect(runTool(base(), 'delete_everything', {}).result.error).toMatch(/Unknown tool/)
  })
})
