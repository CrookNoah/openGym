// The plan generator: answer a few questions, get a whole week.
//
// Picking exercises is the part of a training app that people are worst at and that an app is
// actually well placed to do — it already knows the movement patterns (lib/ladders.js), which
// of them your kit can reach (lib/gear.js), what each one trains (lib/muscles.js) and how hard
// each rung is. What it never did was put those together.
//
// The whole module is a pure function of the answers plus S: same inputs, same plan, no
// randomness. That matters because the plan is checked against the muscle map before you ever
// see it — a generator you cannot re-run and audit is a generator you have to take on faith.
//
// It picks: a split that fits your days, which weekdays to train and which to rest, one
// exercise per movement slot at a difficulty that matches your experience and goal, and the
// sets, reps and rest between them. Then it measures its own output and fills the gaps.

import { LADDERS, rungsFor, ladderOf } from './ladders.js'
import { EXIDX, exOr } from './exercises.js'
import { PATTERN_GROUP } from './kit.js'
import { loadOf, MUSCLES, MUSCLE_NAME } from './muscles.js'
import { canDo } from './gear.js'
import { isHeldRung } from './ladders.js'
import { uid } from './format.js'

/* ============================ the answers ============================ */

// What you are training for. This drives three things at once: the rep range, how hard a
// variation to start you on (a 5-rep goal needs a harder movement than a 15-rep one), and how
// long to rest between sets.
export const GOALS = [
  { key: 'muscle', name: 'Build muscle', hint: 'Moderate reps, moderate rests. The default if you are unsure.',
    reps: [8, 12], rungBias: 0, setsMul: 1.15, restSec: 90, rir: 2 },
  { key: 'strength', name: 'Get stronger', hint: 'Harder variations, fewer reps, longer rests.',
    reps: [5, 8], rungBias: 0.12, setsMul: 1, restSec: 150, rir: 1 },
  { key: 'lean', name: 'Lose fat, keep muscle', hint: 'Higher reps and short rests, so sessions keep your heart rate up.',
    reps: [10, 15], rungBias: -0.12, setsMul: 1, restSec: 60, rir: 2 },
  { key: 'fitness', name: 'General fitness', hint: 'A bit of everything, and the least fussy about hitting numbers.',
    reps: [8, 15], rungBias: 0, setsMul: 0.85, restSec: 75, rir: 3 },
]

// Where on a ladder to start. Nothing to do with how fit you feel — only with how much
// practice you have at these specific movements.
// `rung` is a FRACTION of the ladder, not an index into it. The ladders are wildly different
// lengths — ten rungs of push-up against two of calf raise — so an absolute index put someone
// with "some experience" on a kneeling push-up and a handstand in the same session.
export const LEVELS = [
  { key: 'new', name: 'New to this', hint: 'Start on the easiest version of everything and build up.', rung: 0.1 },
  { key: 'some', name: 'Some experience', hint: 'You can do a full push-up and a bodyweight squat comfortably.', rung: 0.35 },
  { key: 'strong', name: 'Been training a while', hint: 'Start on harder variations.', rung: 0.65 },
]

// How hard you want to be hit. This is weekly set volume and how close to failure you aim —
// the two levers that actually decide whether a week is easy or brutal.
export const INTENSITY = [
  { key: 'easy', name: 'Take it steady', hint: 'Lower volume. Good while building a habit, or alongside a busy life.', setsMul: 0.75, rirAdj: 1 },
  { key: 'normal', name: 'Push me', hint: 'The volume most people make progress on.', setsMul: 1, rirAdj: 0 },
  { key: 'hard', name: 'Hard as it goes', hint: 'High volume, sets taken close to failure. Only sustainable if you sleep and eat for it.', setsMul: 1.3, rirAdj: -1 },
]

// How long you want to be training for. Caps the number of movements in a session, which is
// the honest lever — a session you skip because it takes an hour trains nothing.
export const LENGTHS = [
  { key: 'short', name: 'About 20 minutes', slots: 4 },
  { key: 'medium', name: 'About 40 minutes', slots: 6 },
  { key: 'long', name: 'An hour or more', slots: 8 },
]

export const DEFAULT_ANSWERS = { goal: 'muscle', level: 'some', intensity: 'normal', length: 'medium', days: 3 }

const byKey = (list, key) => list.find(x => x.key === key) || list[0]
export const goalOf = a => byKey(GOALS, a && a.goal)
export const levelOf = a => byKey(LEVELS, a && a.level)
export const intensityOf = a => byKey(INTENSITY, a && a.intensity)
export const lengthOf = a => byKey(LENGTHS, a && a.length)

/* ============================ the week ============================ */

// Which weekdays to train, per number of sessions. These are the arrangements people actually
// use, not an even spread computed on the fly: the constraint is recovery, and it is not
// symmetric. Four days works as two pairs with a break in the middle; five puts its rest day
// after three, not after four. 0 = Sunday, matching getDay() and S.week everywhere else.
const WEEK_SHAPE = {
  1: [3],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
}
// Why those days, in a sentence the preview can show. A plan that tells you when to rest
// should be able to say why.
const REST_WHY = {
  1: 'One session, placed midweek so a missed Monday does not write off the week.',
  2: 'Three days apart, so each session is fully recovered before the next.',
  3: 'A rest day after every session — the arrangement that suits three full efforts a week.',
  4: 'Two pairs with a break in the middle, so nothing is trained hard two days running.',
  5: 'Three on, one off, two on. The rest lands after the third day, which is where it is needed.',
  6: 'Six days only works because consecutive sessions train different things. Sunday is off, and it matters.',
}

export const MIN_DAYS = 1
export const MAX_DAYS = 6
export const weekShape = days => WEEK_SHAPE[Math.min(MAX_DAYS, Math.max(MIN_DAYS, days || 3))]
export const restWhy = days => REST_WHY[Math.min(MAX_DAYS, Math.max(MIN_DAYS, days || 3))]

/* ============================ the splits ============================ */

// A session is an ordered list of movement patterns. Order is the programming: the pattern
// that matters most goes first, while you are fresh, and pressing and pulling alternate so
// the second press of a session is not done on triceps the first one emptied.
const SESSIONS = {
  full: { name: 'Full Body', emoji: 'figureStrength', slots: ['push', 'row', 'squat', 'hinge', 'core', 'vpush', 'calf', 'legraise'] },
  fullB: { name: 'Full Body B', emoji: 'figureStrength', slots: ['vpush', 'pull', 'hinge', 'squat', 'legraise', 'dip', 'row', 'core'] },
  upper: { name: 'Upper', emoji: 'arm', slots: ['push', 'pull', 'vpush', 'row', 'dip', 'core'] },
  upperB: { name: 'Upper B', emoji: 'arm', slots: ['vpush', 'row', 'push', 'pull', 'dip', 'core'] },
  lower: { name: 'Lower', emoji: 'legs', slots: ['squat', 'hinge', 'calf', 'legraise', 'core'] },
  lowerB: { name: 'Lower B', emoji: 'legs', slots: ['hinge', 'squat', 'legraise', 'calf', 'core'] },
  push: { name: 'Push', emoji: 'figureStrength', slots: ['push', 'vpush', 'dip', 'core'] },
  pull: { name: 'Pull', emoji: 'pullup', slots: ['pull', 'row', 'legraise'] },
  legs: { name: 'Legs', emoji: 'legs', slots: ['squat', 'hinge', 'calf', 'legraise'] },
}

// Which sessions, for how many days. Under four days a split wastes frequency — everything
// gets trained once a week — so those are full-body or upper/lower, and Push/Pull/Legs only
// appears at six days, where it is run twice.
const SPLITS = {
  1: ['full'],
  2: ['full', 'fullB'],
  3: ['upper', 'lower', 'full'],
  4: ['upper', 'lower', 'upperB', 'lowerB'],
  5: ['upper', 'lower', 'push', 'pull', 'legs'],
  6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
}
export const splitFor = days => SPLITS[Math.min(MAX_DAYS, Math.max(MIN_DAYS, days || 3))]
export const splitName = days => {
  const s = splitFor(days)
  return [...new Set(s.map(k => SESSIONS[k].name.replace(/ B$/, '')))].join(' / ')
}

/* ============================ picking the exercise ============================ */

/**
 * Which rung of a ladder to start on: experience, nudged by goal.
 *
 * A 5-rep strength goal on the easiest push-up variation is not a strength stimulus, and a
 * 15-rep goal on a one-arm push-up is not achievable — so the goal moves the starting point
 * as well as the rep range. Always clamped into what the ladder and your kit actually offer.
 */
export function pickRung(S, pattern, answers) {
  const rungs = rungsFor(S, pattern)
  if (!rungs.length) return null
  const frac = levelOf(answers).rung + goalOf(answers).rungBias
  const i = Math.round(Math.max(0, Math.min(1, frac)) * (rungs.length - 1))
  return rungs[i]
}

// Sets for one slot. The first movement of a session gets the most, later ones taper — the
// last exercise of a session is an accessory whether or not it is labelled one.
function setsFor(slotIndex, answers) {
  const base = slotIndex === 0 ? 4 : slotIndex < 3 ? 3 : 2
  const mul = goalOf(answers).setsMul * intensityOf(answers).setsMul
  return Math.max(2, Math.min(5, Math.round(base * mul)))
}

/** One configured exercise for one pattern, or null if the kit cannot reach that pattern. */
export function buildSlot(S, pattern, slotIndex, answers, used) {
  const rungs = rungsFor(S, pattern)
  if (!rungs.length) return null
  const first = pickRung(S, pattern, answers)
  // Do not repeat a movement inside one session; step along the ladder instead.
  let id = first
  if (used && used.has(id)) {
    const i = rungs.indexOf(id)
    id = rungs.find((r, j) => j > i && !used.has(r)) || rungs.find(r => !used.has(r)) || null
  }
  if (!id || !EXIDX[id]) return null

  const g = goalOf(answers)
  const sets = setsFor(slotIndex, answers)
  const ex = EXIDX[id]
  // A hold is prescribed in seconds, and the goal's rep range means nothing to it — a plank
  // range is a plank range regardless of whether you came for strength or fat loss.
  if (isHeldRung(id)) {
    return { id, sets, sec: 30, secMax: 75, weight: 0, mode: 'time', prog: 'time' }
  }
  const [lo, hi] = g.reps
  // A unilateral movement logs the total across both sides, so its target has to be even and
  // is roughly double a two-sided one.
  const side = /one arm|single arm|one leg|single leg|lunge|split squat|side lying|per side/i.test(ex.n || '')
  const reps = side ? Math.ceil(lo * 2 / 2) * 2 : lo
  const repsMax = side ? Math.ceil(hi * 2 / 2) * 2 : hi
  return { id, sets, reps, repsMax, weight: 0, mode: 'reps', ...(side ? { side: true } : {}) }
}

/* ============================ coverage ============================ */

// Movements that exist to plug a specific hole, not to be progressed.
//
// The ladders cover the patterns a training week is built from; these cover the muscles that
// fall between them. Adductors and obliques have no ladder worth building — there is no
// meaningful progression from an easy hip adduction to a hard one — and biceps get nothing
// direct from any pattern on a floor. Curated rather than derived: the catalogue contains
// wrist circles tagged as forearm training, and a generator that reaches for those to close a
// gap is lying about having closed it.
const ACCESSORIES = [
  { muscle: 'adductors', ids: ['3667', '1775'] },          // side lying hip adduction, side plank hip adduction
  { muscle: 'obliques', ids: ['0705', '0687', '0635'] },   // side bridge, russian twist, oblique crunches
  { muscle: 'biceps', ids: ['1769', '1770'] },             // side lying biceps curl, leg concentration curl
  { muscle: 'lower-back', ids: ['0489'] },                 // hyperextension
  { muscle: 'serratus', ids: ['3021'] },                   // scapula push-up
]

// A curated accessory is available when the kit can reach it — the same rule as a ladder rung.
const reachableId = (S, id) => !!EXIDX[id] && canDo(S, EXIDX[id])

/**
 * Every exercise this profile could be prescribed: ladder rungs plus curated accessories.
 * The basis for what counts as trainable — deliberately not the whole catalogue.
 */
export function candidatePool(S) {
  const out = []
  LADDERS.forEach(l => rungsFor(S, l.key).forEach(id => out.push(id)))
  ACCESSORIES.forEach(a => a.ids.forEach(id => { if (reachableId(S, id)) out.push(id) }))
  return [...new Set(out)]
}

/**
 * The most any single set could contribute to each muscle, given what you can train.
 *
 * This is what makes the coverage check honest. A muscle nothing targets directly — obliques
 * on a floor are only ever a supporting muscle, at 0.4 a set — can never reach the same
 * weekly number as a muscle with movements of its own, so demanding it would report a gap
 * that no amount of training could close.
 */
export function bestPerSet(S) {
  const best = {}
  candidatePool(S).forEach(id => {
    const m = loadOf([{ id, sets: 1 }])
    for (const k in m) best[k] = Math.max(best[k] || 0, m[k])
  })
  return best
}

// Weekly effective sets a directly-trainable muscle needs before the plan stops calling it
// neglected. A floor, not a target.
export const MIN_WEEKLY_SETS = 4

// A reference week: three sessions of six movements. Coverage is judged against however much
// training a plan actually contains, as a fraction of that.
const REFERENCE_SLOTS = 3 * 6

/**
 * The bar each muscle has to clear.
 *
 * Scaled twice, both times to keep the check honest rather than to make it easy. By how
 * directly the kit can train that muscle — obliques are only ever a supporting muscle on a
 * floor, so demanding the same number as chest would report a gap no training could close.
 * And by the size of the week: one short session cannot cover a body, and calling that
 * fifteen failures tells you nothing you did not already know when you chose one day.
 */
export function thresholds(S, weekSlots) {
  const best = bestPerSet(S)
  const scale = weekSlots ? Math.min(1, weekSlots / REFERENCE_SLOTS) : 1
  const out = {}
  MUSCLES.forEach(m => { if (best[m] > 0) out[m] = Math.round(MIN_WEEKLY_SETS * best[m] * scale * 10) / 10 })
  return out
}

/** Muscles the kit can train at all. Everything else is a limit, not an oversight. */
export const trainableMuscles = S => Object.keys(thresholds(S))

/** How many movement slots a week contains — the size the coverage bar is scaled against. */
export const weekSlotCount = (routines, week) =>
  Object.values(week || {}).reduce((n, rid) => {
    const r = (routines || []).find(x => x.id === rid)
    return n + (r ? r.ex.length : 0)
  }, 0)

/** Weekly effective sets per muscle for a whole generated week. */
export function weeklyLoad(routines, week) {
  const total = {}
  Object.values(week || {}).forEach(rid => {
    const r = (routines || []).find(x => x.id === rid)
    if (!r) return
    const l = loadOf((r.ex || []).map(e => ({ id: e.id, sets: e.sets || 1 })))
    for (const k in l) total[k] = (total[k] || 0) + l[k]
  })
  return total
}

/** Muscles this plan under-trains, against what it is fair to expect of the kit. */
export function coverageGaps(S, routines, week) {
  const load = weeklyLoad(routines, week)
  const th = thresholds(S, weekSlotCount(routines, week))
  // Worst first, measured as the fraction of the bar that is missing. Sessions have a length
  // limit, so the order decides who gets the last slot — and a muscle on nothing at all needs
  // it more than one sitting just under its threshold.
  return Object.keys(th)
    .filter(m => (load[m] || 0) < th[m])
    .sort((a, b) => (1 - (load[b] || 0) / th[b]) - (1 - (load[a] || 0) / th[a]))
}

/** Exercises that would most directly close a gap in one muscle, best first. */
export function fillersFor(S, muscle) {
  const scored = candidatePool(S)
    .map(id => ({ id, w: (loadOf([{ id, sets: 1 }])[muscle] || 0) }))
    .filter(x => x.w > 0)
    .sort((a, b) => b.w - a.w)
  return scored.map(x => x.id)
}

/* ============================ the generator ============================ */

// When a session asks for a pattern the kit cannot reach, train the nearest thing rather than
// leaving a hole. Vertical pulling with no bar becomes more horizontal pulling: not the same
// movement, but the same muscles, which is the honest substitution available.
const SUBSTITUTE = { pull: 'row', row: 'pull', vpush: 'push', dip: 'push', calf: 'squat', legraise: 'core', core: 'legraise' }

// Which half of the body a muscle belongs to, so a backfilled accessory lands in a session
// that makes sense. Hip adductions on upper day is not wrong exactly, but it reads as an
// afterthought — which is what it was, before this.
const MUSCLE_GROUP = {
  chest: 'upper', 'upper-back': 'upper', deltoids: 'upper', trapezius: 'upper', serratus: 'upper',
  biceps: 'upper', triceps: 'upper', forearm: 'upper',
  gluteal: 'lower', quadriceps: 'lower', hamstring: 'lower', adductors: 'lower',
  calves: 'lower', tibialis: 'lower', 'hip-flexors': 'lower',
  abs: 'core', obliques: 'core', 'lower-back': 'core',
}
// A session's own half, from the patterns it already contains. Core work fits anywhere.
function routineGroup(r) {
  const counts = {}
  ;(r.ex || []).forEach(e => {
    const pos = ladderOf(e.id)
    const g = pos ? PATTERN_GROUP[pos.ladder.key] : null
    if (g) counts[g] = (counts[g] || 0) + 1
  })
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null
}
// Best home for a muscle's accessory: a session training the same half, shortest first;
// otherwise the shortest session with room.
function homeFor(muscle, candidates) {
  const want = MUSCLE_GROUP[muscle]
  const byLen = [...candidates].sort((a, b) => a.ex.length - b.ex.length)
  if (!want || want === 'core') return byLen[0]
  return byLen.find(r => routineGroup(r) === want) || byLen[0]
}

/** One configured accessory, for backfilling a gap. */
function accessoryCfg(S, id, slotIndex, answers) {
  if (!reachableId(S, id)) return null
  const g = goalOf(answers)
  const sets = setsFor(Math.max(3, slotIndex), answers)   // accessories are never the main lift
  if (isHeldRung(id)) return { id, sets, sec: 30, secMax: 75, weight: 0, mode: 'time', prog: 'time' }
  const ex = EXIDX[id]
  const side = /one arm|single arm|one leg|single leg|lunge|split squat|side lying|side plank|per side/i.test(ex.n || '')
  const [lo, hi] = g.reps
  return {
    id, sets, weight: 0, mode: 'reps',
    reps: side ? Math.ceil(lo * 2 / 2) * 2 : lo,
    repsMax: side ? Math.ceil(hi * 2 / 2) * 2 : hi,
    ...(side ? { side: true } : {}),
  }
}

/**
 * Build a whole week.
 *
 * Returns { routines, week, report } — nothing is written to state here, so the caller can
 * show it before committing. `report` is what makes the plan auditable: the split, why those
 * rest days, weekly sets per muscle, what it had to add to cover a gap, and what it could not
 * cover at all.
 */
export function generatePlan(S, answersIn) {
  const answers = { ...DEFAULT_ANSWERS, ...(answersIn || {}) }
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, answers.days || 3))
  const slotCap = lengthOf(answers).slots
  const shape = weekShape(days)
  const keys = splitFor(days)

  const seen = {}
  const routines = keys.map(k => {
    const spec = SESSIONS[k]
    seen[k] = (seen[k] || 0) + 1
    const used = new Set()
    const ex = []
    // Walk the session's patterns, substituting anything the kit cannot reach, and keep
    // going past the list if a short session is still under the length asked for.
    const wanted = [...spec.slots, ...spec.slots.map(x => SUBSTITUTE[x]).filter(Boolean)]
    for (const pattern of wanted) {
      if (ex.length >= slotCap) break
      const target = rungsFor(S, pattern).length ? pattern : SUBSTITUTE[pattern]
      if (!target) continue
      const cfg = buildSlot(S, target, ex.length, answers, used)
      if (cfg) { used.add(cfg.id); ex.push(cfg) }
    }
    return {
      id: uid(),
      name: seen[k] > 1 ? `${spec.name} ${seen[k]}` : spec.name,
      emoji: spec.emoji,
      prog: 'linear',
      ex,
    }
  })

  const week = {}
  shape.forEach((d, i) => { if (routines[i]) week[d] = routines[i].id })
  const trained = () => routines.filter(r => Object.values(week).includes(r.id))

  // ---- audit and backfill ----
  // The check a person would do by eye on the muscle map, run before you ever see the plan.
  // Loops rather than making one pass: adding a movement changes the numbers, so the only way
  // to know a gap is closed is to measure again. Bounded by the fact that each pass either
  // adds something or gives up on that muscle.
  const filled = []
  const hardCap = Math.min(9, slotCap + 2)   // accessories may stretch a session, never double it
  for (let pass = 0; pass < 6; pass++) {
    const gaps = coverageGaps(S, routines, week)
    if (!gaps.length) break
    let progressed = false
    for (const muscle of gaps) {
      const all = fillersFor(S, muscle)
      if (!all.length) continue
      const already = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
      const fresh = all.filter(id => !already.has(id))
      const target = homeFor(muscle, trained().filter(r => r.ex.length < hardCap))

      if (fresh.length && target) {
        const cfg = accessoryCfg(S, fresh[0], target.ex.length, answers)
        if (cfg) {
          target.ex.push(cfg)
          filled.push({ muscle, name: exOr(cfg.id).n, routine: target.name })
          progressed = true
          continue
        }
      }
      // Nothing new to add — some muscles have exactly one movement that trains them, and one
      // set of it does not close a four-set gap. Deepen what is already there instead, up to
      // a sane ceiling, before giving up on the muscle.
      const entry = routines.flatMap(r => r.ex).find(e => all.includes(e.id) && e.sets < 5)
      if (entry) { entry.sets += 1; progressed = true; continue }
      // Or put the same movement in a second session, which is frequency rather than volume.
      const other = homeFor(muscle, trained().filter(r => r.ex.length < hardCap && !r.ex.some(e => all.includes(e.id))))
      if (other) {
        const cfg = accessoryCfg(S, all[0], other.ex.length, answers)
        if (cfg) {
          other.ex.push(cfg)
          filled.push({ muscle, name: exOr(cfg.id).n, routine: other.name })
          progressed = true
          continue
        }
      }
      // Every session is full and this muscle is still on nothing. The last exercise of a
      // session is the least valuable thing in the week — if everything it trains is already
      // comfortably covered, trading it for one that closes a real gap is a better plan.
      if (fresh.length) {
        const load = weeklyLoad(routines, week)
        const th = thresholds(S, weekSlotCount(routines, week))
        const room = homeFor(muscle, trained())
        const last = room && room.ex[room.ex.length - 1]
        const expendable = last && Object.entries(loadOf([{ id: last.id, sets: last.sets }]))
          .every(([m, v]) => !th[m] || (load[m] || 0) - v >= th[m])
        if (expendable) {
          const cfg = accessoryCfg(S, fresh[0], room.ex.length, answers)
          if (cfg) {
            const dropped = exOr(last.id).n
            room.ex[room.ex.length - 1] = cfg
            filled.push({ muscle, name: exOr(cfg.id).n, routine: room.name, replaced: dropped })
            progressed = true
          }
        }
      }
    }
    if (!progressed) break
  }
  const gaps = coverageGaps(S, routines, week)

  const load = weeklyLoad(routines, week)
  const g = goalOf(answers)
  const inten = intensityOf(answers)
  return {
    routines,
    week,
    report: {
      days,
      splitName: splitName(days),
      restWhy: restWhy(days),
      restDays: [0, 1, 2, 3, 4, 5, 6].filter(d => !week[d]),
      load,
      thresholds: thresholds(S, weekSlotCount(routines, week)),
      ranked: MUSCLES.filter(m => (load[m] || 0) > 0).sort((a, b) => load[b] - load[a]),
      gaps,
      gapNames: gaps.map(m => MUSCLE_NAME[m]),
      // Muscles no amount of training with this kit could reach — a limit to state, not a
      // failure to hide. On a bare floor this is traps and shins.
      untrainable: MUSCLES.filter(m => !thresholds(S)[m]),
      untrainableNames: MUSCLES.filter(m => !thresholds(S)[m]).map(m => MUSCLE_NAME[m]),
      filled,
      totalSets: routines.reduce((n, r) => n + r.ex.reduce((m, e) => m + (e.sets || 0), 0), 0),
      restSec: g.restSec,
      // RIR is "reps left in the tank" — the app's own effort scale. Lower means closer to
      // failure, so a harder intensity subtracts.
      rir: Math.max(0, Math.min(4, g.rir + inten.rirAdj)),
      goalName: g.name,
      intensityName: inten.name,
    },
  }
}

/** Write a generated plan into a draft state (call inside store.update). */
export function applyPlan(s, plan, { replace } = {}) {
  if (replace) {
    s.routines = []
    s.week = {}
  }
  s.routines.push(...plan.routines)
  Object.entries(plan.week).forEach(([d, id]) => { s.week[d] = id })
  // Rest between sets is part of the prescription, not a preference the plan should ignore.
  if (plan.report && plan.report.restSec) s.restSec = plan.report.restSec
}
