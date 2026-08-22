import { describe, it, expect } from 'vitest'
import { needsSetup, dietDirection, dietPlanFor, sessionBurn, gearAdvice, kgOf } from './setup.js'

const today = () => new Date().toISOString().slice(0, 10)
const fresh = (over = {}) => ({
  unit: 'lb', workouts: [], routines: [], bodyweight: [], gear: null,
  setupDone: null, targetW: null, week: {}, ...over,
})

describe('needsSetup', () => {
  it('only a genuinely blank profile qualifies', () => {
    expect(needsSetup(fresh())).toBe(true)
    expect(needsSetup(null)).toBe(false)
    expect(needsSetup(fresh({ setupDone: '2026-01-01' }))).toBe(false)
    expect(needsSetup(fresh({ workouts: [{ id: 'w', d: today() }] }))).toBe(false)
    expect(needsSetup(fresh({ routines: [{ id: 'r', ex: [] }] }))).toBe(false)
    expect(needsSetup(fresh({ bodyweight: [{ d: today(), w: 180 }] }))).toBe(false)
    // Kit chosen — even "floor only" — means they found their way in already.
    expect(needsSetup(fresh({ gear: [] }))).toBe(false)
  })
})

describe('dietDirection', () => {
  const at = (w, tgt) => fresh({ bodyweight: [{ d: today(), w }], targetW: tgt })
  it('the goal weight decides when it is set and actually differs', () => {
    expect(dietDirection(at(180, 170), 'muscle')).toBe('lose')
    expect(dietDirection(at(160, 175), 'lean')).toBe('gain')
    // Within the dead band the goal weight is "stay here", so the training goal speaks.
    expect(dietDirection(at(180, 180.5), 'lean')).toBe('lose')
  })
  it('otherwise the training goal implies it', () => {
    expect(dietDirection(at(180, null), 'lean')).toBe('lose')
    expect(dietDirection(at(180, null), 'muscle')).toBe('gain')
    expect(dietDirection(at(180, null), 'strength')).toBe('gain')
    expect(dietDirection(at(180, null), 'fitness')).toBe('hold')
  })
})

describe('dietPlanFor', () => {
  const lb180 = (tgt, goal = 'muscle') =>
    dietPlanFor(fresh({ bodyweight: [{ d: today(), w: 180 }], targetW: tgt }), goal)

  it('needs a weigh-in — every number is per-kilo', () => {
    expect(dietPlanFor(fresh(), 'muscle')).toBe(null)
  })

  it('maintenance ≈ 31 kcal/kg, rounded to 50 — an estimate must not look like a measurement', () => {
    const p = lb180(null, 'fitness')
    const kg = kgOf(180, 'lb')
    expect(p.maintenance % 50).toBe(0)
    expect(Math.abs(p.maintenance - kg * 31)).toBeLessThanOrEqual(25)
    expect(p.kcal).toBe(p.maintenance)   // hold = eat maintenance
  })

  it('cuts harder than it bulks, and protein rises in a deficit', () => {
    const cut = lb180(160), gain = lb180(200)
    expect(cut.dir).toBe('lose')
    expect(gain.dir).toBe('gain')
    expect(cut.maintenance - cut.kcal).toBe(500)
    expect(gain.kcal - gain.maintenance).toBe(250)
    expect(cut.p).toBeGreaterThan(gain.p)
    expect(cut.p).toBe(Math.round(kgOf(180, 'lb') * 2.0))
    expect(gain.p).toBe(Math.round(kgOf(180, 'lb') * 1.6))
  })

  it('macros account for the calories: 4/4/9 adds back up to the target', () => {
    const p = lb180(160)
    const implied = p.p * 4 + p.c * 4 + p.f * 9
    expect(Math.abs(implied - p.kcal)).toBeLessThanOrEqual(15)
  })

  it('a light person cutting is held above the floor, and told', () => {
    const p = dietPlanFor(fresh({ unit: 'kg', bodyweight: [{ d: today(), w: 48 }], targetW: 43 }), 'lean')
    expect(p.floored).toBe(true)
    expect(p.kcal).toBeGreaterThanOrEqual(Math.round((48 * 24) / 50) * 50)
    expect(lb180(160).floored).toBe(false)
  })

  it('says roughly how many weeks the goal weight is out', () => {
    // 180 → 160 lb ≈ 9.1 kg at 0.45 kg/week ≈ 20 weeks.
    expect(lb180(160).weeks).toBeGreaterThanOrEqual(18)
    expect(lb180(160).weeks).toBeLessThanOrEqual(22)
    expect(lb180(null).weeks).toBe(null)   // no goal weight, no countdown
  })
})

describe('sessionBurn', () => {
  it('scales with minutes and body weight, in a plausible band', () => {
    const b = sessionBurn(45, 80)   // 45 min at 80 kg
    expect(b).toBeGreaterThan(200)
    expect(b).toBeLessThan(400)
    expect(Math.abs(sessionBurn(90, 80) - 2 * b)).toBeLessThanOrEqual(1)
    expect(Math.abs(sessionBurn(45, 40) - b / 2)).toBeLessThanOrEqual(1)
  })
})

describe('gearAdvice', () => {
  it('is empty until kit has actually been chosen — an unfiltered profile can already "do" everything', () => {
    expect(gearAdvice(fresh(), {})).toEqual([])
  })

  it('a floor-only profile is told about the bar first, and why in muscles', () => {
    const picks = gearAdvice(fresh({ gear: [] }), { goal: 'muscle' })
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.length).toBeLessThanOrEqual(3)
    expect(picks[0].key).toBe('bar')
    expect(picks[0].patterns.length).toBeGreaterThan(0)
    expect(picks[0].muscles.length).toBeGreaterThan(0)
  })

  it('still has something to say once the bar is owned — depth, not just reach', () => {
    const picks = gearAdvice(fresh({ gear: ['bar'] }), { goal: 'muscle' })
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every(p => p.key !== 'bar')).toBe(true)
    // Each pick unlocks something concrete, even when no whole pattern is locked.
    picks.forEach(p => expect(p.patterns.length + p.muscles.length + p.exN).toBeGreaterThan(0))
    // Ladder depth outranks a big loaded catalogue: kit that deepens the progression spine
    // comes before "buy a barbell" in an app someone chose for training at home.
    const withRungs = picks.filter(p => p.rungN > 0)
    if (withRungs.length) expect(picks[0].rungN).toBeGreaterThan(0)
  })

  it('never says "buy machines" — that row means a gym membership', () => {
    const picks = gearAdvice(fresh({ gear: ['bar', 'dip', 'rings', 'bench', 'bands', 'vest', 'dumbbell', 'kettlebell'] }), { goal: 'strength' })
    expect(picks.every(p => p.key !== 'machines')).toBe(true)
  })

  it('never recommends what is already owned', () => {
    const picks = gearAdvice(fresh({ gear: ['bar', 'dip', 'rings', 'bench', 'bands'] }), { goal: 'muscle' })
    expect(picks.every(p => !['bar', 'dip', 'rings', 'bench', 'bands'].includes(p.key))).toBe(true)
  })

  it('the vest earns a place for a strength goal with something to hang from', () => {
    const kit = ['bar', 'dip']
    const strength = gearAdvice(fresh({ gear: kit }), { goal: 'strength' })
    expect(strength.some(p => p.key === 'vest')).toBe(true)
    // A fitness beginner with the same kit only hears about it if it unlocks something.
    const easy = gearAdvice(fresh({ gear: kit }), { goal: 'fitness', level: 'new' })
    const vest = easy.find(p => p.key === 'vest')
    if (vest) expect(vest.patterns.length + vest.muscles.length).toBeGreaterThan(0)
  })

  it('every recommendation says why', () => {
    gearAdvice(fresh({ gear: [] }), { goal: 'muscle' }).forEach(p => {
      expect(typeof p.why).toBe('string')
      expect(p.why.length).toBeGreaterThan(10)
    })
  })
})
