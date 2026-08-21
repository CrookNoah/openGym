import { describe, it, expect } from 'vitest'
import { routineMuscles, weekAudit, adjacentOverlap, sessionMinutes } from './week.js'
import { MUSCLES } from './muscles.js'
import { generatePlan, DEFAULT_ANSWERS } from './planner.js'

const FLOOR = { gear: [] }

// A believable little push day: horizontal pressing plus its decline variation.
const PUSH = { id: 'p', name: 'Push', ex: [
  { id: '0662', sets: 4, reps: 10 },   // push-up
  { id: '0279', sets: 4, reps: 8 },    // decline push-up
] }
const PULL = { id: 'q', name: 'Pull', ex: [
  { id: '0652', sets: 4, reps: 6 },    // pull-up
] }

describe('routineMuscles', () => {
  it('names what a routine trains, hardest first', () => {
    const m = routineMuscles(PUSH)
    expect(m[0]).toBe('chest')
    expect(m.length).toBeLessThanOrEqual(5)
  })

  it('is empty for an empty routine', () => {
    expect(routineMuscles({ ex: [] })).toEqual([])
    expect(routineMuscles(null)).toEqual([])
  })
})

describe('weekAudit', () => {
  it('has nothing to say about an empty week', () => {
    expect(weekAudit({ routines: [], week: {} })).toBe(null)
    expect(weekAudit({ routines: [PUSH], week: {} })).toBe(null)
  })

  it('partitions every trainable muscle into covered, light or missed', () => {
    const a = weekAudit({ ...FLOOR, routines: [PUSH], week: { 1: 'p' } })
    const all = [...a.light, ...a.missed, ...a.untrainable]
    expect(new Set(all).size).toBe(all.length)
    all.forEach(m => expect(MUSCLES).toContain(m))
    // A push-only week trains chest and neglects the whole posterior chain.
    expect(a.missed).toContain('hamstring')
    expect(a.light).not.toContain('chest')
    expect(a.missed).not.toContain('chest')
  })

  it('holds a generated plan to its own standard and finds nothing', () => {
    // The wizard audits and backfills before handing a plan over, so re-auditing its output
    // with this file must come back clean — if it does not, the two measures have diverged.
    const { routines, week } = generatePlan(FLOOR, { ...DEFAULT_ANSWERS, days: 3 })
    const a = weekAudit({ ...FLOOR, routines, week })
    expect(a.light).toEqual([])
    expect(a.missed).toEqual([])
  })
})

describe('adjacentOverlap', () => {
  it('flags the same heavy session on back-to-back days', () => {
    const warn = adjacentOverlap({ routines: [PUSH], week: { 1: 'p', 2: 'p' } })
    expect(warn.length).toBe(1)
    expect(warn[0].day).toBe(1)
    expect(warn[0].shared[0]).toBe('chest')
  })

  it('says nothing when a rest day sits between them', () => {
    expect(adjacentOverlap({ routines: [PUSH], week: { 1: 'p', 3: 'p' } })).toEqual([])
  })

  it('lets push and pull sit next to each other', () => {
    expect(adjacentOverlap({ routines: [PUSH, PULL], week: { 1: 'p', 2: 'q' } })).toEqual([])
  })

  it('never warns about assistance work — a pull day is not a shoulder day', () => {
    // Rows and pull-ups load the rear delts as secondaries all day long; that is not what a
    // rest day exists to separate, and warning about it teaches people to ignore warnings.
    const PULLS = { id: 'q2', name: 'Pull 2', ex: [
      { id: '0652', sets: 4 }, { id: '3166', sets: 4 },
    ] }
    const warn = adjacentOverlap({ routines: [PUSH, PULLS], week: { 1: 'p', 2: 'q2' } })
    expect(warn).toEqual([])
  })

  it('never warns about daily-trainable muscles — core work two days running is fine', () => {
    const CORE = { id: 'c', name: 'Core', ex: [
      { id: '0687', sets: 4 },   // russian twist
      { id: '0705', sets: 4 },   // side bridge
    ] }
    expect(adjacentOverlap({ routines: [CORE], week: { 1: 'c', 2: 'c' } })).toEqual([])
  })

  it('checks the week as a circle, Saturday into Sunday', () => {
    const warn = adjacentOverlap({ routines: [PUSH], week: { 6: 'p', 0: 'p' } })
    expect(warn.length).toBe(1)
    expect(warn[0].day).toBe(6)
    expect(warn[0].next).toBe(0)
  })
})

describe('sessionMinutes', () => {
  it('prices a rep session: work per set plus rest between sets', () => {
    // 3 × 10 reps = 3 × 30 s work + 2 × 90 s rest = 270 s
    expect(sessionMinutes({ ex: [{ id: '0662', sets: 3, reps: 10 }] }, 90)).toBe(5)
  })

  it('counts a warm-up set as one more set', () => {
    // 4 sets' work + 3 rests = 390 s ≈ 7 min (vs 5 without)
    expect(sessionMinutes({ ex: [{ id: '0662', sets: 3, reps: 10, warmup: true }] }, 90)).toBe(7)
  })

  it('prices holds by their prescribed time and cardio by its own clock', () => {
    // 2 × 60 s hold + 1 × 90 s rest = 210 s
    expect(sessionMinutes({ ex: [{ id: '3665', sets: 2, sec: 60, mode: 'time' }] }, 90)).toBe(4)
    // 20 min of cardio adds no rest rows
    expect(sessionMinutes({ ex: [{ id: '3220', sets: 1, min: 20, mode: 'cardio' }] }, 90)).toBe(20)
  })

  it('clamps a rep-set to something a human takes', () => {
    // 5 reps is not a 15-second set: clamped to 20 s → 3×20 + 2×90 = 240 s
    expect(sessionMinutes({ ex: [{ id: '0662', sets: 3, reps: 5 }] }, 90)).toBe(4)
  })

  it('is zero for an empty routine and survives nonsense', () => {
    expect(sessionMinutes({ ex: [] })).toBe(0)
    expect(sessionMinutes(null)).toBe(0)
  })
})
