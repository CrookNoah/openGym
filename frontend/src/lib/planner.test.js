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
import { adjacentOverlap } from './week.js'
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

  // The sweeps below each walk all 648 answer combinations. generatePlan is deterministic
  // (asserted above), so one shared memo keeps that at 648 generations instead of five times
  // that — and each sweep still carries an explicit timeout, because 648 generations on a
  // loaded CI runner does not fit vitest's 5-second default.
  const planCache = new Map()
  const planFor = ans => {
    const k = JSON.stringify(ans)
    if (!planCache.has(k)) planCache.set(k, generatePlan(FLOOR, ans))
    return planCache.get(k)
  }
  const SWEEP = { timeout: 60000 }

  it('only ever prescribes exercises that exist and that the kit can reach', SWEEP, () => {
    everyCombo.forEach(ans => {
      planFor(ans).routines.forEach(r => r.ex.forEach(e => {
        expect(EXIDX[e.id], `${JSON.stringify(ans)}: unknown id ${e.id}`).toBeTruthy()
        expect(canDo(FLOOR, EXIDX[e.id]), `${EXIDX[e.id].n} needs kit`).toBe(true)
      }))
    })
  })

  it('never repeats an exercise inside one session', SWEEP, () => {
    everyCombo.forEach(ans => {
      planFor(ans).routines.forEach(r => {
        expect(new Set(r.ex.map(e => e.id)).size, `${JSON.stringify(ans)}/${r.name}`).toBe(r.ex.length)
      })
    })
  })

  it('never leaves a session too thin to be worth doing', SWEEP, () => {
    everyCombo.forEach(ans => {
      planFor(ans).routines.forEach(r =>
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

  it('produces configs the progression engine can read from session one', SWEEP, () => {
    everyCombo.slice(0, 60).forEach(ans => {
      const { routines } = planFor(ans)
      routines.forEach(r => r.ex.forEach(cfg => {
        expect(isBw(cfg), EXIDX[cfg.id].n).toBe(true)
        expect(nextPrescription(FLOOR, cfg, r).kind, EXIDX[cfg.id].n).toBe('first')
        // A ceiling is what makes the ladder fire instead of adding a rep forever.
        const ceiling = modeOf(cfg) === 'time' ? cfg.secMax : cfg.repsMax
        expect(ceiling, EXIDX[cfg.id].n).toBeGreaterThan(0)
      }))
    })
  })

  it('keeps a unilateral target even, so both sides get the rep', SWEEP, () => {
    everyCombo.forEach(ans => {
      planFor(ans).routines.forEach(r => r.ex.forEach(e => {
        if (e.side) expect(e.reps % 2, EXIDX[e.id].n).toBe(0)
      }))
    })
  })

  it('never trips its own back-to-back warning, for any answers', SWEEP, () => {
    // The Plan screen's Week check warns when consecutive days hit the same hard muscles
    // (lib/week.js). The generator scores session placement against that exact measure, so
    // a plan it built must arrive clean — pressing "generate" and being scolded by the
    // app's own checker is a contract violation, not a tuning issue.
    everyCombo.forEach(ans => {
      const { routines, week } = planFor(ans)
      const warn = adjacentOverlap({ ...FLOOR, routines, week })
      expect(warn, JSON.stringify({ ans, warn: warn.map(w => [w.day, w.next, w.shared]) })).toEqual([])
    })
  })

  it('never trips the warning on a full-gym profile either', SWEEP, () => {
    // Loaded lifts change what every session hits hard, so the floor sweep alone would miss
    // exactly the profile in the bug report this test pins.
    everyCombo.forEach(ans => {
      const { routines, week } = generatePlan(GYM, ans)
      const warn = adjacentOverlap({ ...GYM, routines, week })
      expect(warn, JSON.stringify({ ans, warn: warn.map(w => [w.day, w.next, w.shared]) })).toEqual([])
      // And an extra slot steps to a *nearby* rung: past beginner level, a gym plan must
      // never prescribe the very bottom of a ladder (wall push-ups next to a bench press).
      if (ans.level !== 'new') routines.forEach(r => r.ex.forEach(e => {
        expect(['0659', '3132'], `${JSON.stringify(ans)}/${r.name}: ${e.id}`).not.toContain(e.id)
      }))
    })
  })

  it('writes every session in coach order: mains, accessories, conditioning last', SWEEP, () => {
    everyCombo.forEach(ans => {
      planFor(ans).routines.forEach(r => {
        // Class per entry: 0 = a movement-pattern slot (ladder rung or loaded lift),
        // 1 = accessory, 2 = cardio. Once the class steps up it must never step back down.
        const cls = r.ex.map(e => (EXIDX[e.id].bp === 'cardio' ? 2 : patternKeyOf(e.id) ? 0 : 1))
        for (let i = 1; i < cls.length; i++) {
          expect(cls[i], `${JSON.stringify(ans)}/${r.name}: ${r.ex.map(x => EXIDX[x.id].n).join(' → ')}`)
            .toBeGreaterThanOrEqual(cls[i - 1])
        }
      })
    })
  })

  it('gives a timed hold a rule it is allowed to run', SWEEP, () => {
    everyCombo.forEach(ans => {
      planFor(ans).routines.forEach(r => r.ex.forEach(e => {
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

/* ---- planner v2: loaded lifts, history, schedule, supersets, finisher ---- */
import { chooseDays, loadedFor, historyRungFor, patternKeyOf, LOADED } from './planner.js'
import { supersetUnits } from './history.js'
import { gearOf } from './gear.js'

describe('loaded lifts', () => {
  it('is built entirely from ids that resolve, each needing exactly the kit it claims', () => {
    Object.entries(LOADED).forEach(([pattern, list]) => list.forEach(o => {
      expect(EXIDX[o.id], `${pattern}: unknown id ${o.id}`).toBeTruthy()
      // The primary kit the classifier reads off the exercise must be among the declared
      // needs — otherwise the plan could prescribe a lift the library filter then hides.
      expect(o.needs, `${pattern}/${EXIDX[o.id].n}`).toContain(gearOf(EXIDX[o.id]))
    }))
  })

  it('gives a barbell owner the barbell lift and a floor nothing', () => {
    expect(loadedFor({ gear: ['barbell', 'bench'] }, 'push')).toBe('0025')
    expect(loadedFor({ gear: ['dumbbell', 'bench'] }, 'push')).toBe('0289')
    expect(loadedFor(FLOOR, 'push')).toBe(null)
  })

  it('knows a bench press needs the bench as well as the bar', () => {
    expect(loadedFor({ gear: ['barbell'] }, 'push')).toBe(null)
    expect(loadedFor({ gear: ['barbell'] }, 'squat')).toBe('0043')   // a squat needs no bench
  })

  it('prefers real dips and real pull-ups over their cable stand-ins', () => {
    expect(loadedFor({ gear: ['machines', 'dip', 'bar'] }, 'dip')).toBe(null)
    expect(loadedFor({ gear: ['machines', 'dip', 'bar'] }, 'pull')).toBe(null)
    expect(loadedFor({ gear: ['machines'] }, 'pull')).toBe('2330')
  })

  it('puts loaded lifts into the generated plan, with the goal rep range and no ceiling', () => {
    const { routines, report } = generatePlan({ gear: ['dumbbell', 'bench'] }, A({ days: 3 }))
    expect(report.loadedCount).toBeGreaterThan(5)
    const bench = routines.flatMap(r => r.ex).find(e => e.id === '0289')
    expect(bench).toBeTruthy()
    expect(bench.reps).toBe(GOALS[0].reps[0])
    expect(bench.repsMax).toBeUndefined()   // plates are the ladder; no rep ceiling needed
  })

  it('covers everything trainable for a dumbbell-and-bench home setup', () => {
    const r = generatePlan({ gear: ['dumbbell', 'bench'] }, A({ days: 3 })).report
    expect(r.gapNames).toEqual([])
    // Dumbbells make traps trainable (shrugs) — only shins should remain out of reach.
    expect(r.untrainableNames).toEqual(['Shins'])
  })

  it('makes a machines-only profile pull with the lat pulldown, not nothing', () => {
    const ids = generatePlan({ gear: ['machines'] }, A({ days: 6 })).routines.flatMap(r => r.ex.map(e => e.id))
    expect(ids).toContain('2330')
  })
})

describe('history-aware difficulty', () => {
  const recent = (id, daysAgo = 8) => ({
    gear: [],
    workouts: [{
      id: 'w', d: '2026-08-10', start: Date.now() - daysAgo * 86400000,
      entries: [{ id, sets: [{ w: 0, r: 6, done: true }], target: { sets: 3, reps: 6 } }],
    }],
  })

  it('starts a pattern at the hardest rung actually performed recently', () => {
    // The questionnaire says "new to this", the log says archer push-ups. The log wins.
    const S = recent('3294')
    expect(historyRungFor(S, 'push')).toBe('3294')
    const ids = generatePlan(S, A({ level: 'new', days: 3 })).routines.flatMap(r => r.ex.map(e => e.id))
    expect(ids).toContain('3294')
    expect(ids).not.toContain('3211')   // and not the kneeling push-up the answer implied
  })

  it('ignores history older than the window', () => {
    expect(historyRungFor(recent('3294', 120), 'push')).toBe(null)
  })

  it('ignores sets that were never checked off', () => {
    const S = recent('3294')
    S.workouts[0].entries[0].sets[0].done = false
    expect(historyRungFor(S, 'push')).toBe(null)
  })

  it('clamps down to what the current kit reaches', () => {
    // Pull-up history on a profile that has since said floor-only must not prescribe a bar.
    expect(historyRungFor(recent('0652'), 'pull')).toBe(null)
  })

  it('reports how many placements came from history', () => {
    expect(generatePlan(recent('3294'), A({ level: 'new', days: 3 })).report.fromHistory).toBeGreaterThan(0)
    expect(generatePlan(FLOOR, A({ days: 3 })).report.fromHistory).toBe(0)
  })
})

describe('training on the days you actually have', () => {
  it('spreads the chosen count as far apart as the available days allow', () => {
    expect(chooseDays([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5])
    expect(chooseDays([5, 6, 0, 1], 2).length).toBe(2)
  })

  it('uses every available day when there are no spares', () => {
    expect(chooseDays([0, 6], 2).sort()).toEqual([0, 6])
    expect(chooseDays([2], 1)).toEqual([2])
  })

  it('schedules only on the days that were ticked', () => {
    const { week } = generatePlan(FLOOR, A({ days: 2, availableDays: [2, 3, 5] }))
    Object.keys(week).forEach(d => expect([2, 3, 5]).toContain(+d))
  })

  it('drops to the days that exist rather than inventing one', () => {
    const { week, report } = generatePlan(FLOOR, A({ days: 3, availableDays: [0, 6] }))
    expect(Object.keys(week)).toHaveLength(2)
    expect(report.daysClamped).toBe(true)
    expect(report.days).toBe(2)
  })

  it('ignores nonsense day numbers instead of scheduling day nine', () => {
    const { week } = generatePlan(FLOOR, A({ days: 2, availableDays: [9, -1, 2, 5] }))
    Object.keys(week).forEach(d => expect([2, 5]).toContain(+d))
  })
})

describe('the fat-loss extras', () => {
  const lean = () => generatePlan(FLOOR, A({ goal: 'lean', days: 3 }))

  it('pairs a press with a pull as supersets, adjacent and never timed', () => {
    const { routines, report } = lean()
    expect(report.supersets).toBeGreaterThan(0)
    routines.forEach(r => {
      // Every superset id must group ADJACENT entries — the contract the workout screen
      // and cleanupSg both rely on.
      const units = supersetUnits(r.ex)
      units.filter(u => u.length > 1).forEach(u => {
        u.forEach(i => expect(r.ex[i].mode).not.toBe('time'))
        expect(u.length).toBe(2)
      })
    })
  })

  it('ends each session with a conditioning finisher, held for time', () => {
    const { routines, report } = lean()
    expect(report.finisher).toBe('burpee')
    routines.forEach(r => {
      const fin = r.ex.find(e => e.id === '1160')
      expect(fin, r.name).toBeTruthy()
      expect(fin.mode).toBe('time')
      expect(fin.prog).toBe('time')
    })
  })

  it('keeps the finisher out of the coverage arithmetic', () => {
    // Conditioning trains no mapped muscle; counting it as a movement slot would raise the
    // coverage bar without adding anything that could meet it.
    const { routines, week } = lean()
    const withFin = routines.reduce((n, r) => n + r.ex.length, 0)
    expect(weekSlotCount(routines, week)).toBe(withFin - routines.length)
  })

  it('adds neither for the other goals', () => {
    const r = generatePlan(FLOOR, A({ goal: 'muscle', days: 3 })).report
    expect(r.supersets).toBe(0)
    expect(r.finisher).toBe(null)
  })
})

describe('the target effort rides on the routine', () => {
  it('stamps every routine with the RIR the plan was built around', () => {
    const { routines, report } = generatePlan(FLOOR, A({ intensity: 'hard' }))
    routines.forEach(r => expect(r.rir).toBe(report.rir))
  })
})
