import { describe, it, expect } from 'vitest'
import {
  generatePlan, applyPlan, pickRung, weekShape, splitFor, splitName, thresholds,
  coverageGaps, weeklyLoad, weekSlotCount, candidatePool, bestPerSet, trainableMuscles,
  GOALS, LEVELS, INTENSITY, LENGTHS, MIN_DAYS, MAX_DAYS, MIN_WEEKLY_SETS, DEFAULT_ANSWERS,
} from './planner.js'
import { EXIDX } from './exercises.js'
import { canDo } from './gear.js'
import { rungsFor } from './ladders.js'
import { modeOf, isBw } from './history.js'
import { nextPrescription } from './progression.js'

const FLOOR = { gear: [], routines: [], workouts: [], unit: 'lb' }
const BAR = { ...FLOOR, gear: ['bar'] }
const GYM = { routines: [], workouts: [], unit: 'lb' }   // never chose — everything available
const A = (over) => ({ ...DEFAULT_ANSWERS, ...over })

// Every answer combination, for the sweeps.
const everyCombo = []
for (const g of GOALS) for (const l of LEVELS) for (const i of INTENSITY) for (const n of LENGTHS) for (const d of [1, 2, 3, 4, 5, 6]) {
  everyCombo.push({ goal: g.key, level: l.key, intensity: i.key, length: n.key, days: d })
}

describe('the week shape', () => {
  it('trains the number of days asked for', () => {
    for (let d = MIN_DAYS; d <= MAX_DAYS; d++) expect(weekShape(d)).toHaveLength(d)
  })

  it('never schedules the same weekday twice, and stays inside a week', () => {
    for (let d = MIN_DAYS; d <= MAX_DAYS; d++) {
      const w = weekShape(d)
      expect(new Set(w).size).toBe(d)
      w.forEach(x => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(6) })
    }
  })

  it('never stacks three training days in a row below five days a week', () => {
    // At four days or fewer there is no reason to; the recovery cost buys nothing.
    for (let d = 1; d <= 4; d++) {
      const set = new Set(weekShape(d))
      for (let day = 0; day <= 4; day++) {
        const three = [day, day + 1, day + 2].every(x => set.has(x))
        expect(three, `${d} days runs ${day}-${day + 2} together`).toBe(false)
      }
    }
  })

  it('clamps nonsense day counts instead of returning nothing', () => {
    // Zero and undefined both mean "no answer", which falls to the three-day default rather
    // than to one day — nobody choosing a plan meant to ask for none.
    expect(weekShape(0)).toHaveLength(3)
    expect(weekShape(undefined)).toHaveLength(3)
    expect(weekShape(-5)).toEqual(weekShape(MIN_DAYS))
    expect(weekShape(99)).toEqual(weekShape(MAX_DAYS))
  })

  it('gives a split for every day count, one session per training day', () => {
    for (let d = MIN_DAYS; d <= MAX_DAYS; d++) expect(splitFor(d)).toHaveLength(d)
    expect(splitName(3)).toContain('Upper')
    expect(splitName(6)).toContain('Push')
  })

  it('does not use a Push/Pull/Legs split below six days', () => {
    // Three days of PPL trains everything once a week, which is the wrong shape.
    for (let d = 1; d <= 5; d++) expect(splitName(d)).not.toBe('Push / Pull / Legs')
  })
})

describe('pickRung', () => {
  it('scales with the ladder, so a short ladder is not read like a long one', () => {
    // The push ladder is ten rungs on a floor and the overhead one is four. An absolute
    // index put "some experience" on a kneeling push-up and a handstand in one session.
    const push = pickRung(FLOOR, 'push', A({ level: 'some' }))
    const vpush = pickRung(FLOOR, 'vpush', A({ level: 'some' }))
    expect(EXIDX[push].n).toBe('push-up')
    expect(EXIDX[vpush].n).not.toMatch(/handstand/i)
  })

  it('starts a beginner near the bottom and a trained lifter higher up', () => {
    const rungs = rungsFor(FLOOR, 'push')
    const i = k => rungs.indexOf(pickRung(FLOOR, 'push', A({ level: k })))
    expect(i('new')).toBeLessThan(i('some'))
    expect(i('some')).toBeLessThan(i('strong'))
    expect(i('new')).toBeLessThanOrEqual(1)
  })

  it('lets the goal nudge the difficulty, because a rep range implies one', () => {
    const rungs = rungsFor(FLOOR, 'push')
    const strength = rungs.indexOf(pickRung(FLOOR, 'push', A({ goal: 'strength' })))
    const lean = rungs.indexOf(pickRung(FLOOR, 'push', A({ goal: 'lean' })))
    expect(strength).toBeGreaterThan(lean)
  })

  it('never falls off either end of a ladder', () => {
    LEVELS.forEach(l => GOALS.forEach(g => {
      ['push', 'vpush', 'calf', 'dip', 'core'].forEach(p => {
        const id = pickRung(FLOOR, p, A({ level: l.key, goal: g.key }))
        expect(rungsFor(FLOOR, p), `${p}/${l.key}/${g.key}`).toContain(id)
      })
    }))
  })

  it('has no answer for a pattern the kit cannot reach', () => {
    expect(pickRung(FLOOR, 'pull', A())).toBe(null)     // no bar, no vertical pulling
    expect(pickRung(BAR, 'pull', A())).toBeTruthy()
  })
})

describe('coverage bookkeeping', () => {
  it('only counts exercises the plan could actually prescribe', () => {
    // Not the whole catalogue: it contains wrist circles tagged as forearm training, and a
    // generator that "covers" forearms with those is lying.
    const pool = candidatePool(FLOOR)
    expect(pool.length).toBeGreaterThan(20)
    pool.forEach(id => expect(canDo(FLOOR, EXIDX[id]), EXIDX[id].n).toBe(true))
  })

  it('scales each muscle by how directly it can be trained', () => {
    const th = thresholds(FLOOR)
    // Chest has movements of its own; obliques on a floor are only ever a supporting muscle.
    expect(th.chest).toBe(MIN_WEEKLY_SETS)
    expect(th.obliques).toBeLessThan(th.chest)
  })

  it('scales the bar to how much training a week contains', () => {
    const small = thresholds(FLOOR, 6)
    const full = thresholds(FLOOR, 18)
    expect(small.chest).toBeLessThan(full.chest)
  })

  it('reports what a floor genuinely cannot train, and does not blame the plan for it', () => {
    const can = trainableMuscles(FLOOR)
    expect(can).not.toContain('trapezius')     // needs a bar to hang from, or a shrug
    expect(can).not.toContain('tibialis')      // needs resisted dorsiflexion
    expect(trainableMuscles(BAR)).toContain('trapezius')
  })

  it('counts a week the same way the muscle map does', () => {
    const { routines, week, report } = generatePlan(FLOOR, A())
    expect(weeklyLoad(routines, week)).toEqual(report.load)
    expect(weekSlotCount(routines, week)).toBe(routines.reduce((n, r) => n + r.ex.length, 0))
  })
})

describe('generatePlan', () => {
  it('is deterministic — same answers, same plan', () => {
    const a = generatePlan(FLOOR, A({ days: 4 }))
    const b = generatePlan(FLOOR, A({ days: 4 }))
    expect(a.routines.map(r => r.ex.map(e => e.id))).toEqual(b.routines.map(r => r.ex.map(e => e.id)))
    expect(a.report.load).toEqual(b.report.load)
  })

  it('produces one routine per training day, each scheduled', () => {
    for (let d = MIN_DAYS; d <= MAX_DAYS; d++) {
      const { routines, week } = generatePlan(FLOOR, A({ days: d }))
      expect(routines).toHaveLength(d)
      expect(Object.keys(week)).toHaveLength(d)
      expect(new Set(Object.values(week)).size).toBe(d)
    }
  })

  it('gives every routine a distinct name and id', () => {
    const { routines } = generatePlan(FLOOR, A({ days: 6 }))
    expect(new Set(routines.map(r => r.id)).size).toBe(6)
    expect(new Set(routines.map(r => r.name)).size).toBe(6)
  })

  it('only ever prescribes exercises that exist and that the kit can reach', () => {
    everyCombo.forEach(ans => {
      generatePlan(FLOOR, ans).routines.forEach(r => r.ex.forEach(e => {
        expect(EXIDX[e.id], `${JSON.stringify(ans)}: unknown id ${e.id}`).toBeTruthy()
        expect(canDo(FLOOR, EXIDX[e.id]), `${EXIDX[e.id].n} needs kit`).toBe(true)
      }))
    })
  })

  it('never repeats an exercise inside one session', () => {
    everyCombo.forEach(ans => {
      generatePlan(FLOOR, ans).routines.forEach(r => {
        expect(new Set(r.ex.map(e => e.id)).size, `${JSON.stringify(ans)}/${r.name}`).toBe(r.ex.length)
      })
    })
  })

  it('never leaves a session too thin to be worth doing', () => {
    everyCombo.forEach(ans => {
      generatePlan(FLOOR, ans).routines.forEach(r =>
        expect(r.ex.length, `${JSON.stringify(ans)}/${r.name}`).toBeGreaterThanOrEqual(3))
    })
  })

  it('keeps a session near the length that was asked for', () => {
    LENGTHS.forEach(len => {
      generatePlan(FLOOR, A({ length: len.key, days: 3 })).routines.forEach(r => {
        // Backfilling to close a coverage gap may stretch a session, never double it.
        expect(r.ex.length, len.key).toBeLessThanOrEqual(Math.min(9, len.slots + 2))
      })
    })
  })

  it('covers everything trainable once there is enough training to do it', () => {
    // Three or more days at a normal session length is where a plan should have no excuses.
    ;[3, 4, 5, 6].forEach(days => {
      ['medium', 'long'].forEach(length => {
        const r = generatePlan(FLOOR, A({ days, length, intensity: 'normal' })).report
        expect(r.gapNames, `${days}d/${length}`).toEqual([])
      })
    })
  })

  it('says what it added to close a gap, rather than doing it silently', () => {
    const r = generatePlan(FLOOR, A({ days: 3 })).report
    expect(r.filled.length).toBeGreaterThan(0)
    r.filled.forEach(f => {
      expect(f.name).toBeTruthy()
      expect(f.routine).toBeTruthy()
    })
  })

  it('reports a shortfall it could not fix instead of hiding it', () => {
    // One short session a week cannot cover a body, and the honest output says so.
    const r = generatePlan(FLOOR, A({ days: 1, length: 'short' })).report
    expect(r.gapNames.length).toBeGreaterThan(0)
  })

  it('turns the goal into a rep range', () => {
    GOALS.forEach(g => {
      const reps = generatePlan(FLOOR, A({ goal: g.key })).routines
        .flatMap(r => r.ex).filter(e => modeOf(e) === 'reps' && !e.side)
      reps.forEach(e => {
        expect(e.reps, g.key).toBeGreaterThanOrEqual(g.reps[0])
        expect(e.repsMax, g.key).toBeLessThanOrEqual(g.reps[1])
      })
    })
  })

  it('turns intensity into volume', () => {
    const sets = k => generatePlan(FLOOR, A({ intensity: k })).report.totalSets
    expect(sets('easy')).toBeLessThan(sets('normal'))
    expect(sets('normal')).toBeLessThan(sets('hard'))
  })

  it('turns the goal into a rest time and an effort target', () => {
    expect(generatePlan(FLOOR, A({ goal: 'strength' })).report.restSec)
      .toBeGreaterThan(generatePlan(FLOOR, A({ goal: 'lean' })).report.restSec)
    expect(generatePlan(FLOOR, A({ intensity: 'hard' })).report.rir)
      .toBeLessThan(generatePlan(FLOOR, A({ intensity: 'easy' })).report.rir)
  })

  it('gives more work for more days', () => {
    expect(generatePlan(FLOOR, A({ days: 2 })).report.totalSets)
      .toBeLessThan(generatePlan(FLOOR, A({ days: 5 })).report.totalSets)
  })

  it('uses the bar the moment there is one', () => {
    const floor = generatePlan(FLOOR, A({ days: 4 })).routines.flatMap(r => r.ex).map(e => e.id)
    const bar = generatePlan(BAR, A({ days: 4 })).routines.flatMap(r => r.ex).map(e => e.id)
    const pullIds = rungsFor(BAR, 'pull')
    expect(floor.some(id => pullIds.includes(id))).toBe(false)
    expect(bar.some(id => pullIds.includes(id))).toBe(true)
  })

  it('substitutes rather than leaving a hole when a pattern is unreachable', () => {
    // A floor-only "Pull" day cannot do vertical pulling; it should still be a pulling day.
    const { routines } = generatePlan(FLOOR, A({ days: 6 }))
    const pullDay = routines.find(r => r.name.startsWith('Pull'))
    expect(pullDay.ex.length).toBeGreaterThanOrEqual(3)
  })

  it('produces configs the progression engine can read from session one', () => {
    everyCombo.slice(0, 60).forEach(ans => {
      const { routines } = generatePlan(FLOOR, ans)
      routines.forEach(r => r.ex.forEach(cfg => {
        expect(isBw(cfg), EXIDX[cfg.id].n).toBe(true)
        expect(nextPrescription(FLOOR, cfg, r).kind, EXIDX[cfg.id].n).toBe('first')
        // A ceiling is what makes the ladder fire instead of adding a rep forever.
        const ceiling = modeOf(cfg) === 'time' ? cfg.secMax : cfg.repsMax
        expect(ceiling, EXIDX[cfg.id].n).toBeGreaterThan(0)
      }))
    })
  })

  it('keeps a unilateral target even, so both sides get the rep', () => {
    everyCombo.forEach(ans => {
      generatePlan(FLOOR, ans).routines.forEach(r => r.ex.forEach(e => {
        if (e.side) expect(e.reps % 2, EXIDX[e.id].n).toBe(0)
      }))
    })
  })

  it('gives a timed hold a rule it is allowed to run', () => {
    everyCombo.forEach(ans => {
      generatePlan(FLOOR, ans).routines.forEach(r => r.ex.forEach(e => {
        if (modeOf(e) === 'time') expect(e.prog, EXIDX[e.id].n).toBe('time')
      }))
    })
  })

  it('works for a gym profile as well as a floor', () => {
    const r = generatePlan(GYM, A({ days: 4 })).report
    expect(r.gapNames).toEqual([])
  })

  it('survives being asked for nonsense', () => {
    expect(() => generatePlan(FLOOR, {})).not.toThrow()
    expect(() => generatePlan(FLOOR, null)).not.toThrow()
    expect(() => generatePlan(FLOOR, { days: 99, goal: 'nope', level: 'nope' })).not.toThrow()
    expect(generatePlan(FLOOR, { days: 99 }).routines).toHaveLength(MAX_DAYS)
  })
})

describe('applyPlan', () => {
  const plan = () => generatePlan(FLOOR, A({ days: 3 }))

  it('adds the routines and the schedule', () => {
    const s = { routines: [], week: {}, restSec: 90 }
    const p = plan()
    applyPlan(s, p)
    expect(s.routines).toHaveLength(3)
    expect(Object.keys(s.week)).toHaveLength(3)
    expect(s.restSec).toBe(p.report.restSec)
  })

  it('keeps what was already there unless told to replace', () => {
    const s = { routines: [{ id: 'old', name: 'Old', ex: [] }], week: { 0: 'old' }, restSec: 90 }
    applyPlan(s, plan())
    expect(s.routines).toHaveLength(4)
    expect(s.routines.some(r => r.id === 'old')).toBe(true)
  })

  it('clears the old plan when asked', () => {
    const s = { routines: [{ id: 'old', name: 'Old', ex: [] }], week: { 0: 'old' }, restSec: 90 }
    applyPlan(s, plan(), { replace: true })
    expect(s.routines).toHaveLength(3)
    expect(s.routines.some(r => r.id === 'old')).toBe(false)
    expect(Object.values(s.week)).not.toContain('old')
  })
})
