import { describe, it, expect } from 'vitest'
import {
  trendSeries, trendWeight, trendRate, goalProgress, paceVerdict, adherence,
  proposeAdjustment, applyAdjustment, recommendGoal, startGoal, clearGoal,
  goalReminders, daysSinceWeighIn, verdictLine, hasGoal,
  GOAL_ID_BASE, GOAL_ID_MAX, DEF_GOAL_TIME,
} from './goal.js'
import { isoOf } from './format.js'

const dayMs = 86400000
const NOW = new Date(); NOW.setHours(12, 0, 0, 0)
const now = NOW.getTime()
const day = n => { const d = new Date(now); d.setDate(d.getDate() + n); return d }
const at = (offset, hhmm) => {
  const d = day(offset)
  const [h, m] = hhmm.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
// A weigh-in `n` days ago at `w`.
const wi = (n, w) => ({ d: isoOf(day(-n)), w, t: day(-n).getTime() })
// A clean linear descent: `perWeek` lb a week, one weigh-in a day for `days` days.
const descent = (startW, perWeek, days) =>
  Array.from({ length: days }, (_, i) => wi(days - 1 - i, startW - (perWeek / 7) * (days - 1 - i) * -1))
    .map((b, i) => ({ ...b, w: Math.round((startW - (perWeek / 7) * i) * 100) / 100 }))

const base = (over = {}) => ({
  unit: 'lb', bodyweight: [], workouts: [], food: [], routines: [], week: {}, dayPlan: {},
  foodTarget: { kcal: 2000, p: 150, c: 200, f: 60 },
  nudge: { on: true },
  goal: { kind: 'lose', startW: 200, startD: isoOf(day(-28)), targetW: 180, rate: 1,
    baseKcal: 2000, adjustments: [], weighTime: DEF_GOAL_TIME, dismissed: null },
  ...over,
})

describe('the trend', () => {
  it('smooths the scale — a single bad morning barely moves it', () => {
    const steady = [wi(6, 200), wi(5, 200), wi(4, 200), wi(3, 200), wi(2, 200), wi(1, 200)]
    const spiked = [...steady, wi(0, 206)]   // salty dinner
    const t0 = trendWeight({ bodyweight: steady })
    const t1 = trendWeight({ bodyweight: spiked })
    expect(t0).toBeCloseTo(200, 1)
    // The raw number jumped 6 lb; the trend must not.
    expect(t1 - t0).toBeLessThan(1)
    expect(t1).toBeGreaterThan(t0)
  })

  it('follows a real move, just later than the scale does', () => {
    const s = trendSeries({ bodyweight: descent(200, 1, 28) })
    expect(s.length).toBe(28)
    // Trailing indicator: the trend sits above a falling raw weight.
    expect(s[s.length - 1].trend).toBeGreaterThan(s[s.length - 1].w)
    expect(s[s.length - 1].trend).toBeLessThan(s[0].trend)
  })

  it('is gap-aware — a fortnight of silence lets the next reading count', () => {
    const gapped = [wi(30, 200), wi(29, 200), wi(28, 200), wi(0, 190)]
    const t = trendWeight({ bodyweight: gapped })
    // With a fixed per-reading alpha this would still read ~199. Gap-aware, it has moved most
    // of the way to the new number.
    expect(t).toBeLessThan(193)
  })

  it('has nothing to say without weigh-ins', () => {
    expect(trendWeight({ bodyweight: [] })).toBe(null)
    expect(trendSeries(null)).toEqual([])
  })
})

describe('the rate', () => {
  it('recovers a known slope from noisy daily readings', () => {
    const clean = descent(200, 1, 21)
    // ±0.8 lb of deterministic wobble, so the test is not measuring luck.
    const noisy = clean.map((b, i) => ({ ...b, w: b.w + (i % 3 === 0 ? 0.8 : i % 3 === 1 ? -0.8 : 0) }))
    const r = trendRate({ bodyweight: noisy }, 3, now)
    expect(r).toBeLessThan(0)
    expect(Math.abs(r + 1)).toBeLessThan(0.2)   // ≈ −1 lb/week
  })

  it('refuses to answer before there is enough to answer with', () => {
    expect(trendRate({ bodyweight: [] }, 3, now)).toBe(null)
    expect(trendRate({ bodyweight: [wi(2, 200), wi(1, 199), wi(0, 198)] }, 3, now)).toBe(null)   // 3 points
    // Four points but only across four days — still water, not a trend.
    expect(trendRate({ bodyweight: [wi(3, 200), wi(2, 199.5), wi(1, 199), wi(0, 198.5)] }, 3, now)).toBe(null)
  })
})

describe('paceVerdict', () => {
  const withWeighins = bw => base({ bodyweight: bw })

  it('says "early" rather than guessing', () => {
    expect(paceVerdict(withWeighins([wi(1, 200), wi(0, 199)]), now).state).toBe('early')
    expect(paceVerdict(withWeighins([]), now).confident).toBe(false)
  })

  it('reads a plan-matching descent as on track', () => {
    const v = paceVerdict(withWeighins(descent(200, 1, 21)), now)
    expect(v.state).toBe('ontrack')
    expect(v.confident).toBe(true)
  })

  it('separates behind, stalled and wrong way', () => {
    expect(paceVerdict(withWeighins(descent(200, 0.4, 21)), now).state).toBe('behind')
    expect(paceVerdict(withWeighins(descent(200, 0.05, 21)), now).state).toBe('stalled')
    expect(paceVerdict(withWeighins(descent(200, -0.5, 21)), now).state).toBe('wrong')
  })

  it('flags losing fast enough to cost muscle', () => {
    const v = paceVerdict(withWeighins(descent(200, 3, 21)), now)
    expect(v.state).toBe('ahead')
    expect(v.tooFast).toBe(true)
  })

  it('calls it done once the target is reached', () => {
    const S = base({ bodyweight: descent(200, 1, 21), goal: { ...base().goal, targetW: 199 } })
    expect(paceVerdict(S, now).state).toBe('done')
  })

  it('has no verdict without a goal', () => {
    expect(paceVerdict(base({ goal: null }), now)).toBe(null)
    expect(hasGoal(base({ goal: null }))).toBe(false)
  })
})

describe('adherence', () => {
  const meal = (n, kcal) => ({ id: 'f' + n + kcal, d: isoOf(day(-n)), t: day(-n).getTime(), n: 'x', kcal, p: 0, c: 0, f: 0 })

  it('counts logged days, average intake and sessions against plan', () => {
    const S = base({
      food: [meal(1, 2400), meal(2, 2400), meal(3, 2400)],
      routines: [{ id: 'r1', name: 'A', ex: [] }],
      week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' },
      workouts: [{ id: 'w', d: isoOf(day(-1)) }],
    })
    const a = adherence(S, 7, now)
    expect(a.loggedDays).toBe(3)
    expect(a.avgKcal).toBe(2400)
    expect(a.overBy).toBe(400)
    expect(a.sessionsPlanned).toBe(7)
    expect(a.sessionsDone).toBe(1)
  })
})

describe('proposeAdjustment — diagnose before prescribing', () => {
  const meals = (kcal, days) => Array.from({ length: days }, (_, i) =>
    ({ id: 'f' + i, d: isoOf(day(-(i + 1))), t: day(-(i + 1)).getTime(), n: 'x', kcal, p: 0, c: 0, f: 0 }))
  const stalledS = over => base({ bodyweight: descent(200, 0.05, 21), ...over })

  it('says nothing while things are working', () => {
    expect(proposeAdjustment(base({ bodyweight: descent(200, 1, 21) }), now)).toBe(null)
  })

  it('asks for data before it touches the target', () => {
    const p = proposeAdjustment(stalledS({ food: meals(2000, 2) }), now)
    expect(p.kind).toBe('log')
    expect(p.loggedDays).toBe(2)
  })

  it('names adherence when the log shows eating over target', () => {
    const p = proposeAdjustment(stalledS({ food: meals(2400, 6) }), now)
    expect(p.kind).toBe('eat')
    expect(p.overBy).toBe(400)
  })

  it('names missed sessions when the eating was fine', () => {
    const S = stalledS({
      food: meals(2000, 6),
      routines: [{ id: 'r1', name: 'A', ex: [] }],
      week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1' },
      workouts: [],
    })
    const p = proposeAdjustment(S, now)
    expect(p.kind).toBe('train')
    expect(p.done).toBe(0)
  })

  it('only then offers a smaller number', () => {
    const p = proposeAdjustment(stalledS({ food: meals(2000, 6) }), now)
    expect(p.kind).toBe('kcal')
    expect(p.from).toBe(2000)
    expect(p.to).toBe(1850)
  })

  it('will not walk someone into a crash diet — the drift is capped', () => {
    const S = stalledS({ food: meals(1500, 6), foodTarget: { kcal: 1500, p: 150, c: 100, f: 40 } })
    // baseKcal 2000, so a step to 1350 is 650 below where the goal started: refused.
    expect(proposeAdjustment(S, now).kind).toBe('floor')
  })

  it('applying the step keeps protein and scales the rest', () => {
    const s = base()
    applyAdjustment(s, { kind: 'kcal', from: 2000, to: 1850, delta: -150 })
    expect(s.foodTarget.kcal).toBe(1850)
    expect(s.foodTarget.p).toBe(150)              // protein is what keeps the muscle
    expect(s.foodTarget.c).toBeLessThan(200)
    expect(s.goal.adjustments.length).toBe(1)
    expect(s.goal.adjustments[0].to).toBe(1850)
  })
})

describe('recommendGoal', () => {
  it('proposes a whole goal, not a blank field', () => {
    const g = recommendGoal(base({ bodyweight: [wi(0, 200)] }), 'lose')
    expect(g.targetW).toBe(180)               // 10% of body weight
    expect(g.rate).toBeCloseTo(1.2, 1)        // 0.6% a week
    expect(g.weeks).toBeGreaterThan(10)
    expect(g.etaISO).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('gains more slowly than it cuts — a surplus overshoots into fat faster', () => {
    const S = base({ bodyweight: [wi(0, 200)] })
    expect(recommendGoal(S, 'gain').rate).toBeLessThan(recommendGoal(S, 'lose').rate)
  })
  it('needs a weigh-in to build on', () => {
    expect(recommendGoal(base({ bodyweight: [] }), 'lose')).toBe(null)
  })
})

describe('starting and stopping', () => {
  it('anchors at today so progress is measurable, and keeps the chart line in step', () => {
    const s = base({ goal: null, bodyweight: [wi(0, 200)] })
    startGoal(s, { kind: 'lose', startW: 200, targetW: 180, rate: 1.2 })
    expect(s.goal.startD).toBe(isoOf(day(0)))
    expect(s.goal.baseKcal).toBe(2000)
    expect(s.targetW).toBe(180)
    clearGoal(s)
    expect(hasGoal(s)).toBe(false)
    expect(s.bodyweight.length).toBe(1)   // the weigh-ins survive
  })
})

describe('goalReminders', () => {
  const S = (over = {}) => base({ bodyweight: [wi(3, 200), wi(2, 199), wi(1, 199)], ...over })

  it('silent without a goal or with notifications off', () => {
    expect(goalReminders(base({ goal: null }), at(0, '05:00'))).toEqual([])
    expect(goalReminders(S({ nudge: { on: false } }), at(0, '05:00'))).toEqual([])
  })

  it('prompts each morning, and not on a day already weighed', () => {
    const list = goalReminders(S(), at(0, '05:00'))
    const today = list.filter(n => n.iso === isoOf(day(0)) && n.kind === 'weigh')
    expect(today.length).toBe(1)
    expect(new Date(today[0].at).getHours()).toBe(7)
    const weighed = goalReminders(S({ bodyweight: [wi(1, 200), wi(0, 199)] }), at(0, '05:00'))
    expect(weighed.some(n => n.iso === isoOf(day(0)) && n.kind === 'weigh')).toBe(false)
  })

  it('sharpens the longer the scale goes untouched', () => {
    const fresh = goalReminders(S({ bodyweight: [wi(1, 200)] }), at(0, '05:00'))
    const stale = goalReminders(S({ bodyweight: [wi(9, 200)] }), at(0, '05:00'))
    const first = l => l.find(n => n.iso === isoOf(day(0)) && n.kind === 'weigh')
    expect(first(fresh).title).not.toBe(first(stale).title)
    expect(first(stale).body).toMatch(/does not change|holes/)
    expect(daysSinceWeighIn(S({ bodyweight: [wi(9, 200)] }), now)).toBe(9)
  })

  it('adds one Sunday check-in a week, after the weigh-in prompt', () => {
    const list = goalReminders(S(), at(0, '05:00'))
    const ci = list.filter(n => n.kind === 'checkin')
    expect(ci.length).toBe(1)
    expect(new Date(ci[0].at).getDay()).toBe(0)
    expect(new Date(ci[0].at).getHours()).toBe(8)
  })

  it('keeps its ids unique and inside the reserved range', () => {
    const list = goalReminders(S(), at(0, '05:00'))
    expect(new Set(list.map(n => n.id)).size).toBe(list.length)
    list.forEach(n => { expect(n.id).toBeGreaterThanOrEqual(GOAL_ID_BASE); expect(n.id).toBeLessThanOrEqual(GOAL_ID_MAX) })
  })
})

describe('verdictLine', () => {
  it('says something honest for every state', () => {
    const of = bw => verdictLine(base({ bodyweight: bw }), now)
    expect(of([])[0]).toMatch(/gathering/)
    expect(of(descent(200, 1, 21))[0]).toMatch(/On track/)
    expect(of(descent(200, 0.05, 21))[0]).toMatch(/flat/)
    expect(of(descent(200, -0.5, 21))[0]).toMatch(/wrong way/)
    expect(of(descent(200, 3, 21))[0]).toMatch(/costing muscle/)
    expect(verdictLine(base({ goal: null }), now)).toBe(null)
  })
})
