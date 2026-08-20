import { describe, it, expect } from 'vitest'
import { newlyUnlocked, reachablePatterns, bestRoutineFor, proposeAdditions, applyAdditions, PATTERN_GROUP } from './kit.js'
import { ladderOf, LADDERS } from './ladders.js'
import { EXIDX } from './exercises.js'
import { gearOf } from './gear.js'
import { planByKey, buildPlan } from './starter.js'

const FLOOR = []
const BAR = ['bar']

describe('reachablePatterns', () => {
  it('gives a floor everything except vertical pulling', () => {
    const floor = reachablePatterns({ gear: FLOOR })
    expect(floor).not.toContain('pull')
    expect(floor).toContain('push')
    expect(floor).toContain('row')
    expect(floor).toContain('squat')
  })

  it('gives a profile that never chose the lot', () => {
    expect(reachablePatterns({}).length).toBe(LADDERS.length)
  })
})

describe('newlyUnlocked', () => {
  it('names vertical pulling as what a bar buys you', () => {
    expect(newlyUnlocked(FLOOR, BAR)).toEqual(['pull'])
  })

  it('says nothing when the kit did not change', () => {
    expect(newlyUnlocked(FLOOR, FLOOR)).toEqual([])
    expect(newlyUnlocked(BAR, BAR)).toEqual([])
  })

  it('says nothing when kit was removed — losing a bar unlocks nothing', () => {
    expect(newlyUnlocked(BAR, FLOOR)).toEqual([])
  })

  it('treats a missing list as a bare floor', () => {
    expect(newlyUnlocked(null, BAR)).toEqual(['pull'])
  })
})

describe('bestRoutineFor', () => {
  const S = { gear: BAR, routines: [
    { id: 'up', name: 'Upper', ex: [{ id: '0662' }, { id: '3165' }, { id: '0815' }] },   // push, row, dip
    { id: 'lo', name: 'Lower', ex: [{ id: '3119' }, { id: '1373' }] },                    // squat, calf
  ] }

  it('sends a new pulling movement to the day that already pulls', () => {
    expect(bestRoutineFor(S, 'pull', ladderOf).id).toBe('up')
  })

  it('sends a new leg movement to the leg day', () => {
    expect(bestRoutineFor(S, 'hinge', ladderOf).id).toBe('lo')
  })

  it('falls back to the shortest routine when nothing matches', () => {
    const none = { gear: BAR, routines: [
      { id: 'a', name: 'A', ex: [{ id: '0025' }, { id: '0027' }, { id: '0043' }] },
      { id: 'b', name: 'B', ex: [{ id: '0031' }] },
    ] }
    expect(bestRoutineFor(none, 'pull', ladderOf).id).toBe('b')
  })

  it('has no answer for a plan with no routines', () => {
    expect(bestRoutineFor({ gear: BAR, routines: [] }, 'pull', ladderOf)).toBe(null)
  })
})

describe('proposeAdditions', () => {
  const S = { gear: FLOOR, routines: [
    { id: 'up', name: 'Upper', ex: [{ id: '0662' }, { id: '3165' }] },
    { id: 'lo', name: 'Lower', ex: [{ id: '3119' }] },
  ] }

  it('offers the easiest rung of a newly unlocked pattern, in the right routine', () => {
    const out = proposeAdditions(S, FLOOR, BAR, ladderOf)
    expect(out).toHaveLength(1)
    expect(out[0].pattern).toBe('pull')
    expect(out[0].routineId).toBe('up')
    // Bottom of the pull ladder that a bar reaches — not a one-arm chin-up.
    expect(EXIDX[out[0].id]).toBeTruthy()
    expect(out[0].cfg.reps).toBeLessThanOrEqual(8)
  })

  it('offers a configured exercise the engine can read', () => {
    const [p] = proposeAdditions(S, FLOOR, BAR, ladderOf)
    expect(p.cfg.id).toBe(p.id)
    expect(p.cfg.sets).toBeGreaterThan(0)
    expect(p.cfg.repsMax).toBeGreaterThanOrEqual(p.cfg.reps)
  })

  it('offers nothing when the kit did not change', () => {
    expect(proposeAdditions(S, FLOOR, FLOOR, ladderOf)).toEqual([])
  })

  it('offers nothing you already have in that routine', () => {
    const already = { ...S, routines: [
      { id: 'up', name: 'Upper', ex: [{ id: '0662' }, { id: '3165' }, { id: '0499' }, { id: '0688' }, { id: '1326' }] },
      { id: 'lo', name: 'Lower', ex: [{ id: '3119' }] },
    ] }
    const out = proposeAdditions(already, FLOOR, BAR, ladderOf)
    expect(out.every(p => !already.routines[0].ex.some(e => e.id === p.id))).toBe(true)
  })

  it('offers nothing when there is no plan to add to', () => {
    expect(proposeAdditions({ gear: FLOOR, routines: [] }, FLOOR, BAR, ladderOf)).toEqual([])
  })
})

describe('applyAdditions', () => {
  it('appends the chosen exercises to their routines', () => {
    const s = { gear: BAR, routines: [{ id: 'up', name: 'Upper', ex: [{ id: '0662' }] }] }
    applyAdditions(s, [{ id: '1326', routineId: 'up', cfg: { id: '1326', sets: 3, reps: 5 } }])
    expect(s.routines[0].ex).toHaveLength(2)
    expect(s.routines[0].ex[1]).toMatchObject({ id: '1326', sets: 3, reps: 5 })
  })

  it('never adds the same exercise twice', () => {
    const s = { gear: BAR, routines: [{ id: 'up', name: 'Upper', ex: [{ id: '1326' }] }] }
    applyAdditions(s, [{ id: '1326', routineId: 'up', cfg: { id: '1326', sets: 3, reps: 5 } }])
    expect(s.routines[0].ex).toHaveLength(1)
  })

  it('ignores a routine that has since been deleted', () => {
    const s = { gear: BAR, routines: [] }
    expect(() => applyAdditions(s, [{ id: '1326', routineId: 'gone', cfg: {} }])).not.toThrow()
  })
})

describe('every pattern belongs to a group', () => {
  it('so a new movement always has somewhere to land', () => {
    LADDERS.forEach(l => expect(PATTERN_GROUP[l.key], l.key).toBeTruthy())
  })
})

/* A plan can carry kit-gated extras, so one plan serves a bare floor and a floor with a bar. */
describe('buildPlan with equipment', () => {
  const plan = () => planByKey('bw-ulf')

  it('leaves the bar work out for someone training on a floor', () => {
    const { routines } = buildPlan(plan(), { gear: FLOOR })
    expect(routines[0].ex.some(e => e.id === '1326')).toBe(false)
  })

  it('folds real vertical pulling in the moment there is a bar', () => {
    const { routines } = buildPlan(plan(), { gear: BAR })
    const upper = routines[0]
    expect(upper.ex.some(e => e.id === '1326')).toBe(true)
    // …and it lands in Upper, not on leg day.
    expect(routines[1].ex.some(e => e.id === '1326')).toBe(false)
  })

  it('gives an unset profile the extras, matching how gear filtering already behaves', () => {
    const { routines } = buildPlan(plan(), {})
    expect(routines[0].ex.some(e => e.id === '1326')).toBe(true)
  })

  it('still works when called with no state at all', () => {
    expect(() => buildPlan(plan())).not.toThrow()
  })

  it('keeps every kit-gated extra trainable with the kit that gates it', () => {
    STARTER_PLANS_GEAR_EX().forEach(({ key, e }) => {
      expect(EXIDX[e.id], e.id).toBeTruthy()
      expect(gearOf(EXIDX[e.id]), `${e.id} is gated behind ${key}`).toBe(key)
    })
  })
})

// Every gearEx entry across every plan, flattened with the key that gates it.
function STARTER_PLANS_GEAR_EX() {
  const out = []
  ;[planByKey('bw-basics'), planByKey('bw-ulf'), planByKey('gym-ppl')].forEach(p =>
    p.routines.forEach(r => Object.entries(r.gearEx || {}).forEach(([key, list]) =>
      list.forEach(e => out.push({ key, e })))))
  return out
}
