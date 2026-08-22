import { describe, it, expect } from 'vitest'
import {
  mealPlanFor, mealsOf, mealLogged, slotOfEntry, mealReminders, dayLedger,
  DIET_STYLES, MEAL_SLOTS, DEF_MEALS, MEAL_ID_BASE, MEAL_ID_MAX,
} from './meals.js'
import { gearNag, dismissGearNag } from './setup.js'
import { isoOf } from './format.js'

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(12, 0, 0, 0); return d }
const at = (offsetDays, hhmm) => {
  const d = day(offsetDays)
  const [h, m] = hhmm.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
const eat = (offsetDays, hhmm, kcal = 400) =>
  ({ id: 'e' + offsetDays + hhmm, d: isoOf(day(offsetDays)), t: at(offsetDays, hhmm), n: 'meal', kcal, p: 30, c: 40, f: 10 })

const base = (over = {}) => ({
  unit: 'lb', foodTarget: { kcal: 2000, p: 150, c: 200, f: 60 }, food: [],
  meals: { ...DEF_MEALS, on: true }, workouts: [], bodyweight: [], ...over,
})

describe('the styles', () => {
  it('every style splits to exactly 1 — the style moves calories, never changes them', () => {
    DIET_STYLES.forEach(d => {
      const sum = MEAL_SLOTS.reduce((n, s) => n + (d.split[s.key] || 0), 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
    })
  })
  it('every eating slot of every style says what a plate looks like', () => {
    DIET_STYLES.forEach(d => MEAL_SLOTS.forEach(s => {
      if ((d.split[s.key] || 0) > 0) expect(typeof d.foods[s.key]).toBe('string')
    }))
  })
})

describe('mealPlanFor', () => {
  it('needs a calorie target — splitting nothing is noise dressed as a plan', () => {
    expect(mealPlanFor(base({ foodTarget: null }))).toBe(null)
    expect(mealPlanFor(base({ foodTarget: { p: 150 } }))).toBe(null)
  })
  it('the slots re-add to the day, near enough, and protein spreads evenly', () => {
    const plan = mealPlanFor(base())
    expect(plan.length).toBe(4)
    const kcal = plan.reduce((n, m) => n + m.kcal, 0)
    expect(Math.abs(kcal - 2000)).toBeLessThanOrEqual(20)   // per-slot rounding to 10
    plan.forEach(m => expect(m.p).toBe(Math.round(150 / 4)))
  })
  it('16:8 skips breakfast entirely', () => {
    const plan = mealPlanFor(base({ meals: { ...DEF_MEALS, style: 'fasting' } }))
    expect(plan.map(m => m.key)).toEqual(['lunch', 'snack', 'dinner'])
    expect(plan.reduce((n, m) => n + m.kcal, 0)).toBeGreaterThan(1950)
  })
})

describe('bucketing', () => {
  it('an entry lands in the nearest mealtime', () => {
    const S = base()
    expect(slotOfEntry(eat(0, '07:40'), S)).toBe('breakfast')
    expect(slotOfEntry(eat(0, '13:00'), S)).toBe('lunch')
    expect(slotOfEntry(eat(0, '21:40'), S)).toBe('dinner')   // late dinner is still dinner
    expect(slotOfEntry(eat(0, '15:45'), S)).toBe('snack')
  })
  it('a fasting profile never buckets anything into breakfast', () => {
    const S = base({ meals: { ...DEF_MEALS, style: 'fasting' } })
    expect(slotOfEntry(eat(0, '08:00'), S)).not.toBe('breakfast')
  })
  it('mealsOf groups the day and mealLogged reads it', () => {
    const S = base({ food: [eat(0, '08:05'), eat(0, '19:10')] })
    const iso = isoOf(day(0))
    const g = mealsOf(S, iso)
    expect(g.breakfast.length).toBe(1)
    expect(g.dinner.length).toBe(1)
    expect(g.lunch.length).toBe(0)
    expect(mealLogged(S, iso, 'breakfast')).toBe(true)
    expect(mealLogged(S, iso, 'lunch')).toBe(false)
  })
})

describe('mealReminders', () => {
  const todayOnly = (S, now) => mealReminders(S, now).filter(n => n.iso === isoOf(day(0)))

  it('silent when off, or without a plan to speak for', () => {
    expect(mealReminders(base({ meals: { ...DEF_MEALS, on: false } }), at(0, '06:00'))).toEqual([])
    expect(mealReminders(base({ foodTarget: null }), at(0, '06:00'))).toEqual([])
  })

  it('two stages per meal: the menu at mealtime, the memory prompt after', () => {
    const list = todayOnly(base(), at(0, '06:00'))
    expect(list.length).toBe(8)   // 4 meals × 2 stages
    const bf = list.filter(n => n.slot === 'breakfast')
    expect(new Date(bf[0].at).getHours()).toBe(8)
    expect(bf[1].at - bf[0].at).toBe(90 * 60000)
    expect(bf[0].body).toMatch(/kcal/)
    expect(bf[0].body).toMatch(/Eggs|yogurt/i)   // the style's plate, not a bare number
    expect(bf[1].title).toBe('What did you eat?')
  })

  it('a logged meal silences the rest of that slot today — and only that slot', () => {
    const S = base({ food: [eat(0, '08:05')] })
    const list = todayOnly(S, at(0, '06:00'))
    expect(list.some(n => n.slot === 'breakfast')).toBe(false)
    expect(list.some(n => n.slot === 'lunch')).toBe(true)
  })

  it('past mealtimes are simply gone, not fired late', () => {
    const list = todayOnly(base(), at(0, '13:00'))
    expect(list.some(n => n.slot === 'breakfast')).toBe(false)
    expect(list.some(n => n.slot === 'lunch' && n.stage === 0)).toBe(false)
    expect(list.some(n => n.slot === 'lunch' && n.stage === 1)).toBe(true)   // 14:00 follow-up still due
    expect(list.some(n => n.slot === 'dinner')).toBe(true)
  })

  it('covers a rolling week with unique ids inside the reserved range', () => {
    const list = mealReminders(base(), at(0, '06:00'))
    expect(new Set(list.map(n => n.iso)).size).toBe(7)
    expect(new Set(list.map(n => n.id)).size).toBe(list.length)
    list.forEach(n => { expect(n.id).toBeGreaterThanOrEqual(MEAL_ID_BASE); expect(n.id).toBeLessThanOrEqual(MEAL_ID_MAX) })
  })

  it('16:8 never mentions breakfast', () => {
    const list = mealReminders(base({ meals: { ...DEF_MEALS, on: true, style: 'fasting' } }), at(0, '06:00'))
    expect(list.some(n => n.slot === 'breakfast')).toBe(false)
    expect(list.length).toBe(7 * 6)
  })
})

describe('dayLedger', () => {
  it('reports eaten vs target, burn as separate context', () => {
    const S = base({ food: [eat(0, '08:00', 500), eat(0, '12:30', 700)] })
    const l = dayLedger(S, isoOf(day(0)), 300)
    expect(l.eaten).toBe(1200)
    expect(l.target).toBe(2000)
    expect(l.burn).toBe(300)
    expect(dayLedger(base({ foodTarget: null }), isoOf(day(0)), 0).target).toBe(null)
  })
})

describe('gearNag', () => {
  const S = (over = {}) => ({
    unit: 'lb', gear: [], plannerAnswers: { goal: 'muscle', level: 'some' },
    gearNagDismissed: null, workouts: [], routines: [], bodyweight: [], week: {}, ...over,
  })
  it('names the top pick for the goal, and why', () => {
    const g = gearNag(S())
    expect(g.key).toBe('bar')
    expect(typeof g.why).toBe('string')
  })
  it('holds its tongue without a goal, without chosen kit, or freshly dismissed', () => {
    expect(gearNag(S({ plannerAnswers: null }))).toBe(null)
    expect(gearNag(S({ gear: null }))).toBe(null)
    const s = S()
    dismissGearNag(s)
    expect(gearNag(s)).toBe(null)
  })
  it('"not now" wears off — the reminder is constant, just polite about it', () => {
    const s = S()
    dismissGearNag(s)
    expect(gearNag(s, Date.now() + 15 * 86400000)).not.toBe(null)
    expect(gearNag(s, Date.now() + 13 * 86400000)).toBe(null)
  })
})
