// The day of eating, given shape: meals instead of one undifferentiated calorie pot.
//
// The food log answers "what went in"; the daily target answers "how much should"; this
// file answers the question between them — *when and as what*. A day's target is split
// across breakfast, lunch, snacks and dinner by an eating style you choose, each slot gets
// its share of calories and protein and a concrete idea of what that looks like on a plate,
// and log entries are bucketed back into the slot they were eaten in — so "you're set for
// breakfast, dinner is still owed 700 kcal and 40 g of protein" is a computable sentence,
// not a feeling.
//
// The styles are eating patterns, not prescriptions: they move the same target around the
// day and suggest foods in the pattern's spirit, and every number still comes from the
// target *you* set. openGym does not know your allergies, your budget or your religion —
// the suggestions are one honest example each, never a rule. And the same discipline as the
// rest of the app: everything here is a pure function of state and clock, so all of it is
// testable without a phone, and the notification layer is one dumb mirror of it.

import { t } from './i18n.js'
import { isoOf } from './format.js'
import { dayFood, targetOf } from './food.js'

/* ============================ the slots ============================ */

export const MEAL_SLOTS = [
  { key: 'breakfast', name: 'Breakfast' },
  { key: 'lunch', name: 'Lunch' },
  { key: 'snack', name: 'Snacks' },
  { key: 'dinner', name: 'Dinner' },
]
export const SLOT_NAME = Object.fromEntries(MEAL_SLOTS.map(s => [s.key, s.name]))

export const DEF_MEALS = {
  on: false,                       // meal-time reminders (mobile only)
  style: 'balanced',
  times: { breakfast: '08:00', lunch: '12:30', snack: '16:00', dinner: '19:00' },
}

export const mealsCfg = S => ({
  ...DEF_MEALS,
  ...((S && S.meals) || {}),
  times: { ...DEF_MEALS.times, ...(((S && S.meals) || {}).times || {}) },
})

/* ============================ the styles ============================ */

// split: how the day's calories fall across the slots (sums to 1; a zero slot is a slot the
// style deliberately skips). foods: one plain-language plate per slot — an example, not a
// rule. Protein is spread evenly across the eating slots regardless of the calorie split,
// because muscle protein synthesis responds to repeated doses, not one nightly flood.
export const DIET_STYLES = [
  {
    key: 'balanced', name: 'Balanced', hint: 'Four ordinary meals, nothing clever. The default for a reason.',
    split: { breakfast: 0.25, lunch: 0.3, snack: 0.1, dinner: 0.35 },
    foods: {
      breakfast: 'Eggs or yogurt with oats and fruit.',
      lunch: 'A palm of protein, a fist of carbs, plenty of vegetables.',
      snack: 'Fruit and a handful of nuts, or yogurt.',
      dinner: 'Meat or fish with potatoes or rice and vegetables.',
    },
  },
  {
    key: 'vertical', name: 'Vertical diet', hint: 'Red meat and white rice at the core, easy-to-digest sides. Popular with strength athletes.',
    split: { breakfast: 0.2, lunch: 0.3, snack: 0.15, dinner: 0.35 },
    foods: {
      breakfast: 'Eggs with spinach, orange juice, white rice or oats.',
      lunch: 'Lean red meat over white rice, carrots and a pinch of salt.',
      snack: 'Greek yogurt, a banana, bone broth if you have it.',
      dinner: 'Steak or salmon with white rice, sweet potato and low-FODMAP vegetables.',
    },
  },
  {
    key: 'mediterranean', name: 'Mediterranean', hint: 'Fish, olive oil, legumes and vegetables — the pattern with the deepest health evidence.',
    split: { breakfast: 0.25, lunch: 0.35, snack: 0.1, dinner: 0.3 },
    foods: {
      breakfast: 'Yogurt with fruit, nuts and a drizzle of honey.',
      lunch: 'Fish or chicken with a big salad, olive oil, and bread or couscous.',
      snack: 'Olives, fruit, or hummus with vegetables.',
      dinner: 'Legumes or fish with vegetables and whole grains.',
    },
  },
  {
    key: 'highprotein', name: 'High protein', hint: 'Protein anchors every meal — the easiest pattern to cut on without losing muscle.',
    split: { breakfast: 0.25, lunch: 0.3, snack: 0.15, dinner: 0.3 },
    foods: {
      breakfast: 'Egg whites and whole eggs, or skyr with whey stirred in.',
      lunch: 'Chicken or lean beef with rice and vegetables.',
      snack: 'Cottage cheese, a protein shake, or jerky.',
      dinner: 'Fish or lean meat, a modest carb, double vegetables.',
    },
  },
  {
    key: 'fasting', name: '16:8 fasting', hint: 'No breakfast — the day’s eating fits an 8-hour window from lunch on.',
    split: { breakfast: 0, lunch: 0.4, snack: 0.15, dinner: 0.45 },
    foods: {
      lunch: 'Break the fast big: protein, carbs and vegetables in one real meal.',
      snack: 'Fruit and nuts, or yogurt — keep protein coming inside the window.',
      dinner: 'The day’s largest plate: meat or fish, carbs, vegetables.',
    },
  },
]
export const styleOf = S => DIET_STYLES.find(x => x.key === mealsCfg(S).style) || DIET_STYLES[0]

/* ============================ the plan ============================ */

/**
 * The day's meals, priced: [{ key, name, time, kcal, p, foods }] for every slot the style
 * eats in. Null without a calorie target — splitting nothing four ways is noise dressed as
 * a plan, and the target sheet is where that gets fixed first.
 */
export function mealPlanFor(S) {
  const tgt = targetOf(S)
  if (!tgt || !(tgt.kcal > 0)) return null
  const cfg = mealsCfg(S)
  const style = styleOf(S)
  const eating = MEAL_SLOTS.filter(s => (style.split[s.key] || 0) > 0)
  return eating.map(s => ({
    key: s.key,
    name: s.name,
    time: cfg.times[s.key],
    kcal: Math.round(tgt.kcal * style.split[s.key] / 10) * 10,
    // Protein per eating slot, evenly — absent a protein target there is nothing to spread.
    p: tgt.p > 0 ? Math.round(tgt.p / eating.length) : null,
    foods: style.foods[s.key] || null,
  }))
}

/* ============================ bucketing ============================ */

const mins = hhmm => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : 0
}

/**
 * Which meal a log entry belongs to: the eating slot whose configured time is nearest the
 * entry's timestamp (ties to the earlier slot). Deliberately forgiving — dinner at 21:40
 * is still dinner — and it degrades well: yesterday's breakfast logged this morning lands
 * in breakfast, because the timestamp is this morning.
 */
export function slotOfEntry(entry, S) {
  const style = styleOf(S)
  const cfg = mealsCfg(S)
  const eating = MEAL_SLOTS.filter(s => (style.split[s.key] || 0) > 0)
  if (!eating.length) return null
  const d = new Date(entry && entry.t ? entry.t : Date.now())
  const m = d.getHours() * 60 + d.getMinutes()
  let best = eating[0], gap = Infinity
  eating.forEach(s => {
    const g = Math.abs(m - mins(cfg.times[s.key]))
    if (g < gap) { best = s; gap = g }
  })
  return best.key
}

/** The day's log, grouped by meal: { breakfast: [entries], ... } (eating slots only). */
export function mealsOf(S, iso) {
  const out = {}
  MEAL_SLOTS.forEach(s => { if ((styleOf(S).split[s.key] || 0) > 0) out[s.key] = [] })
  dayFood(S, iso).forEach(e => {
    const k = slotOfEntry(e, S)
    if (k && out[k]) out[k].push(e)
  })
  return out
}

export const mealLogged = (S, iso, slotKey) => (mealsOf(S, iso)[slotKey] || []).length > 0

/* ============================ reminders ============================ */

/** Native notification ids reserved for meal reminders — see mobile.js. */
export const MEAL_ID_BASE = 300
export const MEAL_ID_MAX = 300 + 7 * 8   // 7 days × 4 slots × 2 stages

// The second ask trails the mealtime by this much: at mealtime the notification is a menu
// ("about 600 kcal — eggs and oats"), an hour and a half later it is a memory prompt
// ("what did you eat?") — because a log written while the plate is still in mind is the
// only kind that stays honest.
const FOLLOWUP_MIN = 90

/**
 * Every meal notification wanted over the next `days` days — the same shape and contract
 * as the nudge ladder: pure, exhaustive, and silent wherever there is nothing to say
 * (reminders off, no plan, that meal already logged today, the time already past).
 * Logging a meal makes today's remaining notifications for that slot disappear on the
 * next sync, which the store runs after every state change.
 */
export function mealReminders(S, now = Date.now(), days = 7) {
  const cfg = mealsCfg(S)
  if (!cfg.on) return []
  const plan = mealPlanFor(S)
  if (!plan) return []
  const out = []
  for (let k = 0; k < days; k++) {
    const dt = new Date(now)
    dt.setHours(12, 0, 0, 0)
    dt.setDate(dt.getDate() + k)
    const iso = isoOf(dt)
    plan.forEach((meal, si) => {
      // Today's already-eaten meals have nothing left to say; future days can't be judged
      // yet, so they get the full pair and the resync on the day trims them.
      if (k === 0 && mealLogged(S, iso, meal.key)) return
      const at = mins(meal.time)
      ;[0, 1].forEach(stage => {
        const when = new Date(dt)
        when.setHours(0, at + stage * FOLLOWUP_MIN, 0, 0)
        const ms = when.getTime()
        if (ms <= now) return
        const name = t(SLOT_NAME[meal.key])
        const menu = meal.foods
          ? (meal.p
            ? t('About {0} kcal, {1} g protein. {2}', meal.kcal, meal.p, t(meal.foods))
            : t('About {0} kcal. {1}', meal.kcal, t(meal.foods)))
          : t('About {0} kcal.', meal.kcal)
        out.push({
          id: MEAL_ID_BASE + k * 8 + si * 2 + stage,
          iso, slot: meal.key, stage, at: ms,
          title: stage === 0 ? name : t('What did you eat?'),
          body: stage === 0 ? menu
            : t('{0} has nothing logged yet — log it while the plate is still in mind.', name),
        })
      })
    })
  }
  return out
}

/* ============================ in vs out ============================ */

/**
 * The day's energy ledger for the Meals screen: eaten so far, the intake target, and what
 * today's training burned (context only — the target's activity assumption already covers
 * training, so the burn is never added to the allowance; pretending exercise "earns" food
 * is how tracking apps teach people to overeat on gym days).
 */
export function dayLedger(S, iso, burnKcal) {
  const tgt = targetOf(S)
  const eaten = dayFood(S, iso).reduce((n, e) => n + (Number(e.kcal) || 0), 0)
  return {
    eaten: Math.round(eaten),
    target: tgt && tgt.kcal > 0 ? tgt.kcal : null,
    burn: burnKcal > 0 ? Math.round(burnKcal) : null,
  }
}
