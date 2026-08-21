import { describe, it, expect } from 'vitest'
import { routineMuscles, weekAudit, adjacentOverlap } from './week.js'
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
    expect(warn[0].shared.length).toBeGreaterThanOrEqual(2)
  })

  it('says nothing when a rest day sits between them', () => {
    expect(adjacentOverlap({ routines: [PUSH], week: { 1: 'p', 3: 'p' } })).toEqual([])
  })

  it('lets push and pull sit next to each other', () => {
    expect(adjacentOverlap({ routines: [PUSH, PULL], week: { 1: 'p', 2: 'q' } })).toEqual([])
  })

  it('checks the week as a circle, Saturday into Sunday', () => {
    const warn = adjacentOverlap({ routines: [PUSH], week: { 6: 'p', 0: 'p' } })
    expect(warn.length).toBe(1)
    expect(warn[0].day).toBe(6)
    expect(warn[0].next).toBe(0)
  })
})
