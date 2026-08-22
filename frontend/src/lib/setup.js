// First-run setup: the numbers behind the questions.
//
// A fresh install lands on an empty Home and a menu of features to discover one by one.
// The setup flow (setup.jsx) walks the four decisions that make the app worth opening
// tomorrow — where your weight is going, what kit you own, what your week looks like, and
// what to eat for it — and this file is every number that flow quotes, kept pure so all of
// it can be tested without a phone or a browser.
//
// The diet maths deserves its disclaimer up front. The app knows one number about your
// body: what you weigh. Not your height, not your age, not how much you move outside
// training — so everything here is a weight-based estimate of the kind coaches scribble on
// a first consult, offered as a starting point with the honest instruction attached: watch
// the weekly weigh-in trend and adjust. It is deliberately never applied automatically;
// the flow prefills the food targets with it and every field stays editable.

import { GEAR, gearChosen, expandGear, canDo } from './gear.js'
import { EXDB } from './exercises.js'
import { newlyUnlocked } from './kit.js'
import { thresholds } from './planner.js'
import { LADDERS, rungsFor } from './ladders.js'

const LB_PER_KG = 2.20462
export const kgOf = (w, unit) => (unit === 'lb' ? w / LB_PER_KG : w)

/**
 * Only a genuinely blank profile gets the wizard: no workouts, no routines, no weigh-ins,
 * kit never chosen, and the flow never started or skipped before. Any one of those means
 * the person has already found their own way in, and a wizard over a life in progress is
 * an interruption, not a welcome.
 */
export const needsSetup = S =>
  !!S && !S.setupDone && !(S.workouts || []).length && !(S.routines || []).length &&
  !(S.bodyweight || []).length && !gearChosen(S)

/* ============================ diet ============================ */

// Maintenance ≈ 31 kcal per kg per day — the middle of the usual 26–33 band, sitting where
// someone who trains a few days a week and otherwise lives a normal life sits. The honest
// error bar on any formula without height, age or a step count is ±15%, which is exactly
// why the flow says "watch the trend" instead of pretending precision.
const MAINT_KCAL_PER_KG = 31
// ~0.5 kg / 1 lb a week down, and a deliberately smaller step up — a surplus overshoots
// into fat much faster than a deficit overshoots into muscle.
const CUT_KCAL = 500
const GAIN_KCAL = 250
// Never recommend below this, whatever the goal says: crash numbers cost the muscle the
// training is there to keep. The flow says so when the clamp engages.
const FLOOR_KCAL_PER_KG = 24
// Protein: 1.6 g/kg (same source as the food tab's suggestion), raised to 2.0 in a
// deficit — hanging on to muscle while losing weight is the one case the reviews agree
// wants more. Fat floors at a quarter of intake; carbs take what remains.
const PROTEIN_PER_KG = 1.6
const PROTEIN_CUT_PER_KG = 2.0
const FAT_SHARE = 0.25
// How fast a goal weight approaches, for the "roughly N weeks" line.
const CUT_KG_PER_WEEK = 0.45
const GAIN_KG_PER_WEEK = 0.25

const round50 = n => Math.round(n / 50) * 50

/**
 * Which way the scale is meant to move: the goal weight decides when one is set and
 * actually differs; otherwise the training goal implies it (lose-fat cuts, muscle and
 * strength gain, fitness holds).
 */
export function dietDirection(S, goal) {
  const bw = ((S && S.bodyweight) || []).slice(-1)[0]
  const cur = bw && bw.w > 0 ? bw.w : null
  const tgt = S && S.targetW > 0 ? S.targetW : null
  const gap = (S && S.unit) === 'lb' ? 2 : 1
  if (cur && tgt && Math.abs(tgt - cur) >= gap) return tgt > cur ? 'gain' : 'lose'
  return goal === 'lean' ? 'lose' : goal === 'muscle' || goal === 'strength' ? 'gain' : 'hold'
}

/**
 * The recommended day of eating: { dir, maintenance, kcal, p, c, f, weeks, floored }.
 * kcal and maintenance are rounded to 50 — quoting 2 483 kcal from a formula this rough
 * would be dressing an estimate as a measurement. Null without a weigh-in: every number
 * here is per-kilo, so there is nothing honest to say until the scale has spoken.
 */
export function dietPlanFor(S, goal) {
  const bw = ((S && S.bodyweight) || []).slice(-1)[0]
  if (!bw || !(bw.w > 0)) return null
  const kg = kgOf(bw.w, S.unit)
  const dir = dietDirection(S, goal)
  const maintenance = round50(kg * MAINT_KCAL_PER_KG)
  let kcal = maintenance + (dir === 'lose' ? -CUT_KCAL : dir === 'gain' ? GAIN_KCAL : 0)
  const floor = round50(kg * FLOOR_KCAL_PER_KG)
  const floored = kcal < floor
  if (floored) kcal = floor
  const p = Math.round(kg * (dir === 'lose' ? PROTEIN_CUT_PER_KG : PROTEIN_PER_KG))
  const f = Math.round((kcal * FAT_SHARE) / 9)
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4))
  // "Roughly N weeks" only when there is a goal weight to walk towards.
  const tgt = S.targetW > 0 ? S.targetW : null
  const weeks = tgt && dir !== 'hold'
    ? Math.max(1, Math.round(Math.abs(kgOf(tgt, S.unit) - kg) / (dir === 'lose' ? CUT_KG_PER_WEEK : GAIN_KG_PER_WEEK)))
    : null
  return { dir, maintenance, kcal, p, c, f, weeks, floored }
}

/**
 * What one session burns, roughly: calisthenics/strength work sits around 4.5 METs once
 * rests are counted, and kcal/min at a MET is (MET × 3.5 × kg) / 200. Shown as context
 * beside the targets — the maintenance estimate already assumes the training happens, so
 * this must never be added on top, and the flow's wording says so.
 */
export const sessionBurn = (minutes, kg) => Math.round(minutes * (4.5 * 3.5 * kg) / 200)

/* ============================ what to buy ============================ */

// The sentence each purchase gets — why this thing, in training terms rather than shop
// terms. Data decides *whether* an item is recommended (it must unlock something); these
// only say what the unlock means.
const GEAR_WHY = {
  bar: 'Nothing on a floor trains vertical pulling — most of your back is out of reach until you can hang.',
  dip: 'Deep pressing through full range, and the dip ladder to climb.',
  rings: 'Rows and support work that scale from easy to brutal by foot position alone.',
  bench: 'Step-ups, split squats and incline work — legs get much more room to progress.',
  bands: 'Assistance for rungs you cannot do yet, resistance for ones that got easy.',
  vest: 'Adds load once reps stop being the limit — the cheapest strength upgrade there is.',
  dumbbell: 'Loaded pressing, rowing and legs at home — progression stops depending on harder variations alone.',
  kettlebell: 'Swings and goblet work — hinges and carries a floor cannot load.',
  barbell: 'The loaded lifts themselves — squat, hinge and press with weight that grows for years.',
  machines: 'A commercial gym: every pattern loadable, every muscle reachable.',
}

/**
 * What is worth buying for this profile, best first — at most `max` items.
 *
 * Judged by what each single purchase would unlock against the kit as chosen, in the order
 * this app actually values things: a whole movement pattern nothing else reaches weighs
 * most, then muscles that move from untrainable to trainable, then new rungs on the
 * variation ladders — the progression spine — and only then the raw count of exercises,
 * log-damped so "dumbbells add 294 exercises" cannot shout down "dip bars add the dip
 * ladder" in an app someone chose for training at home. An item that unlocks nothing is
 * not recommended, whatever its hint says — with one exception: a dip belt or vest for
 * someone chasing strength who already owns something to hang from, since added load is
 * about progression, not reach. Machines are excluded outright: that row means a gym
 * membership, and "join a gym" is not an answer to "what should I buy". Empty until kit
 * has actually been chosen — unfiltered profiles can already "do" everything.
 */
export function gearAdvice(S, answers = {}, max = 3) {
  if (!gearChosen(S)) return []
  const own = expandGear(S.gear)
  const ladderName = Object.fromEntries(LADDERS.map(l => [l.key, l.name]))
  const before = new Set(Object.keys(thresholds({ ...S, gear: own })))
  const cantYet = EXDB.filter(ex => !canDo({ gear: own }, ex))
  const ownRungs = LADDERS.reduce((n, l) => n + rungsFor({ gear: own }, l.key).length, 0)
  const out = []
  GEAR.forEach(g => {
    if (g.key === 'machines' || own.includes(g.key)) return
    const withIt = { ...S, gear: [...own, g.key] }
    const patterns = newlyUnlocked(own, withIt.gear).map(k => ladderName[k] || k)
    const muscles = Object.keys(thresholds(withIt)).filter(m => !before.has(m))
    const rungN = LADDERS.reduce((n, l) => n + rungsFor({ gear: withIt.gear }, l.key).length, 0) - ownRungs
    const exN = cantYet.filter(ex => canDo(withIt, ex)).length
    const strengthVest = g.key === 'vest' &&
      (answers.goal === 'strength' || answers.level === 'strong') &&
      (own.includes('bar') || own.includes('dip'))
    if (!patterns.length && !muscles.length && !exN && !strengthVest) return
    out.push({
      key: g.key, name: g.name, why: GEAR_WHY[g.key], patterns, muscles, rungN, exN,
      score: patterns.length * 1000 + (strengthVest ? 500 : 0) + muscles.length * 100 +
        rungN * 25 + Math.round(10 * Math.log2(1 + exN)),
    })
  })
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}
