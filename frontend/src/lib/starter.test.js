import { describe, it, expect } from 'vitest'
import { STARTER_PLANS, planByKey, buildPlan, starterRoutines } from './starter.js'
import { EXIDX } from './exercises.js'
import { gearOf, GEAR_KEYS } from './gear.js'
import { modeOf, isBw } from './history.js'
import { nextPrescription } from './progression.js'

describe('the starter plans', () => {
  // Same reasoning as the ladder id test: a typo here is a plan that loads with an "Unknown
  // exercise" in it, and nothing anywhere would have thrown.
  it('is built entirely from ids that resolve in the exercise library', () => {
    STARTER_PLANS.forEach(p => p.routines.forEach(r => r.ex.forEach(e => {
      expect(EXIDX[e.id], `${p.key}/${r.name}: unknown id ${e.id}`).toBeTruthy()
    })))
  })

  it('only claims kit the picker can actually offer', () => {
    STARTER_PLANS.forEach(p => p.gear.forEach(k => expect(GEAR_KEYS).toContain(k)))
  })

  it('schedules every routine it ships, and no routine it does not', () => {
    STARTER_PLANS.forEach(p => {
      const used = new Set(Object.values(p.week))
      expect(used.size, p.key).toBe(p.routines.length)
      Object.values(p.week).forEach(i => expect(p.routines[i], p.key).toBeTruthy())
      Object.keys(p.week).forEach(d => expect(+d).toBeGreaterThanOrEqual(0))
      Object.keys(p.week).forEach(d => expect(+d).toBeLessThanOrEqual(6))
    })
  })

  it('keeps a floor-only plan trainable on a floor', () => {
    STARTER_PLANS.filter(p => !p.gear.length).forEach(p =>
      p.routines.forEach(r => r.ex.forEach(e =>
        expect(gearOf(EXIDX[e.id]), `${p.key}: ${EXIDX[e.id].n}`).toBe('floor'))))
  })

  it('gives every bodyweight entry somewhere to stop climbing', () => {
    // Without a ceiling the engine adds a rep a session forever and the ladder never fires,
    // which would make the whole level-up feature invisible in the plans that need it most.
    STARTER_PLANS.filter(p => !p.gear.length).forEach(p =>
      p.routines.forEach(r => r.ex.forEach(e => {
        const ceiling = modeOf(e) === 'time' ? e.secMax : e.repsMax
        expect(ceiling, `${p.key}: ${EXIDX[e.id].n} has no ceiling`).toBeGreaterThan(0)
      })))
  })

  it('sets a ceiling above the working target, never below it', () => {
    STARTER_PLANS.forEach(p => p.routines.forEach(r => r.ex.forEach(e => {
      if (e.repsMax) expect(e.repsMax, EXIDX[e.id].n).toBeGreaterThanOrEqual(e.reps)
      if (e.secMax) expect(e.secMax, EXIDX[e.id].n).toBeGreaterThanOrEqual(e.sec)
    })))
  })

  it('gives a timed hold a progression rule it is allowed to use', () => {
    // A routine's default is 'linear', which timed work is not allowed to run, so a hold that
    // did not say 'time' for itself would silently progress not at all.
    STARTER_PLANS.forEach(p => p.routines.forEach(r => r.ex.forEach(e => {
      if (modeOf(e) === 'time') expect(e.prog, EXIDX[e.id].n).toBe('time')
    })))
  })

  it('keeps a unilateral target even, so both sides get the rep', () => {
    STARTER_PLANS.forEach(p => p.routines.forEach(r => r.ex.forEach(e => {
      if (e.side) expect(e.reps % 2, EXIDX[e.id].n).toBe(0)
    })))
  })

  it('is read as bodyweight without having to say so', () => {
    STARTER_PLANS.filter(p => !p.gear.length).forEach(p =>
      p.routines.forEach(r => r.ex.forEach(e => expect(isBw(e), EXIDX[e.id].n).toBe(true))))
  })
})

describe('buildPlan', () => {
  it('hands back fresh routines wired to the right weekdays', () => {
    const plan = planByKey('bw-ppl')
    const { routines, week } = buildPlan(plan)
    expect(routines).toHaveLength(3)
    expect(new Set(routines.map(r => r.id)).size).toBe(3)
    expect(week[1]).toBe(routines[0].id)
    expect(week[3]).toBe(routines[1].id)
    expect(week[5]).toBe(routines[2].id)
  })

  it('gives new ids every time, so loading twice never collides', () => {
    const a = buildPlan(planByKey('bw-basics'))
    const b = buildPlan(planByKey('bw-basics'))
    expect(a.routines[0].id).not.toBe(b.routines[0].id)
  })

  it('copies the exercises rather than handing out the shared spec', () => {
    const plan = planByKey('bw-basics')
    const built = buildPlan(plan)
    built.routines[0].ex[0].reps = 999
    expect(plan.routines[0].ex[0].reps).not.toBe(999)
  })

  it('produces a plan the progression engine has an opinion about from session one', () => {
    const { routines } = buildPlan(planByKey('bw-basics'))
    const S = { unit: 'kg', gear: [], workouts: [] }
    routines[0].ex.forEach(cfg => {
      expect(nextPrescription(S, cfg, routines[0]).kind, EXIDX[cfg.id].n).toBe('first')
    })
  })

  it('returns nothing for a key that does not exist', () => {
    expect(planByKey('nope')).toBe(null)
  })
})

describe('starterRoutines', () => {
  // lib/demoSeed.js fabricates twelve weeks of history against these exact ids and shapes.
  it('still returns the barbell push/pull/legs trio the demo seed is built on', () => {
    const [push, pull, legs] = starterRoutines()
    expect(push.name).toBe('Push Day')
    expect(pull.name).toBe('Pull Day')
    expect(legs.name).toBe('Leg Day')
    expect(push.ex[0]).toMatchObject({ id: '0025', sets: 4, reps: 8, weight: 0 })
    expect(legs.ex).toHaveLength(6)
    expect([...push.ex, ...pull.ex, ...legs.ex].every(e => EXIDX[e.id])).toBe(true)
  })
})
