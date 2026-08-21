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
import { loadOf, MUSCLES, MUSCLE_NAME, hardMusclesOf, sharedHard } from './muscles.js'
import { canDo, hasGear } from './gear.js'
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
const clampDays = days => Math.min(MAX_DAYS, Math.max(MIN_DAYS, days || 3))
export const weekShape = days => WEEK_SHAPE[clampDays(days)]
export const restWhy = days => REST_WHY[clampDays(days)]

/**
 * Training days chosen from the days you actually have.
 *
 * The fixed arrangements above assume the whole week is available, which for a lot of people
 * it is not. Given the days you can train, this picks the subset that spreads them furthest
 * apart — recovery is the constraint, and the week is circular, so Sunday-to-Monday counts as
 * one day apart, not six. Brute force over at most C(7,k) subsets, because the honest answer
 * is small enough to just compute.
 */
export function chooseDays(available, count) {
  const days = [...new Set(available)].filter(d => d >= 0 && d <= 6).sort((a, b) => a - b)
  if (days.length <= count) return days
  let best = null, bestScore = -1
  const pick = (start, chosen) => {
    if (chosen.length === count) {
      // Score by the smallest circular gap between consecutive training days — the thing a
      // bad arrangement gets wrong — with the total spread as the tie-break.
      const gaps = chosen.map((d, i) => (chosen[(i + 1) % count] - d + 7) % 7 || 7)
      const score = Math.min(...gaps) * 100 + gaps.reduce((a, b) => a + Math.min(b, 3), 0)
      if (score > bestScore) { bestScore = score; best = [...chosen] }
      return
    }
    for (let i = start; i < days.length; i++) pick(i + 1, [...chosen, days[i]])
  }
  pick(0, [])
  return best || days.slice(0, count)
}

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

// The loaded lift for each pattern, once the kit exists — barbell first, then dumbbell,
// kettlebell, machines. A generator on a calisthenics codebase still has to take a ticked
// barbell seriously: somebody who owns one did not tick it to be prescribed wall push-ups.
// Every entry lists ALL the kit it needs — a bench press needs the bench as well as the bar.
// `unless` skips the loaded option when better bodyweight kit exists: with dip bars, chest
// dips beat a cable pushdown.
export const LOADED = {
  push: [
    { id: '0025', needs: ['barbell', 'bench'] },     // barbell bench press
    { id: '0289', needs: ['dumbbell', 'bench'] },    // dumbbell bench press
    { id: '0577', needs: ['machines'] },             // lever chest press
  ],
  vpush: [
    { id: '0091', needs: ['barbell', 'bench'] },     // barbell seated overhead press
    { id: '0426', needs: ['dumbbell'] },             // dumbbell standing overhead press
    { id: '0603', needs: ['machines'] },             // lever shoulder press
  ],
  row: [
    { id: '0027', needs: ['barbell'] },              // barbell bent over row
    { id: '0293', needs: ['dumbbell'] },             // dumbbell bent over row
    { id: '0541', needs: ['kettlebell'] },           // kettlebell one arm row
    { id: '1350', needs: ['machines'] },             // lever seated row
  ],
  pull: [
    { id: '2330', needs: ['machines'], unless: 'bar' },  // lat pulldown — a real bar beats it
  ],
  squat: [
    { id: '0043', needs: ['barbell'] },              // barbell full squat
    { id: '1760', needs: ['dumbbell'] },             // dumbbell goblet squat
    { id: '0534', needs: ['kettlebell'] },           // kettlebell goblet squat
    { id: '0739', needs: ['machines'] },             // sled 45° leg press
  ],
  hinge: [
    { id: '0085', needs: ['barbell'] },              // barbell romanian deadlift
    { id: '1459', needs: ['dumbbell'] },             // dumbbell romanian deadlift
    { id: '0549', needs: ['kettlebell'] },           // kettlebell swing
  ],
  calf: [
    { id: '0417', needs: ['dumbbell'] },             // dumbbell standing calf raise
    { id: '0108', needs: ['barbell'] },              // barbell standing leg calf raise
    { id: '0605', needs: ['machines'] },             // lever standing calf raise
  ],
  dip: [
    { id: '0241', needs: ['machines'], unless: 'dip' },  // cable pushdown — dip bars beat it
  ],
}

/** The loaded lift this profile should use for a pattern, or null to stay on the ladder. */
export function loadedFor(S, pattern) {
  const opts = LOADED[pattern] || []
  for (const o of opts) {
    if (o.unless && hasGear(S, o.unless)) continue
    if (o.needs.every(k => hasGear(S, k)) && EXIDX[o.id]) return o.id
  }
  return null
}
// pattern for a loaded id — the ladders don't know these ids, so the superset pairing needs
// its own lookup.
const LOADED_PATTERN = {}
Object.entries(LOADED).forEach(([k, list]) => list.forEach(o => { LOADED_PATTERN[o.id] = k }))
export const patternKeyOf = id => LOADED_PATTERN[id] || (ladderOf(id) ? ladderOf(id).ladder.key : null)

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
  // Ninety days of actual training outranks a questionnaire answer. The highest rung you
  // have really performed is where the plan starts — level and goal only speak when the
  // history has nothing to say about this pattern.
  const hist = historyRungFor(S, pattern)
  if (hist) return hist
  const frac = levelOf(answers).rung + goalOf(answers).rungBias
  const i = Math.round(Math.max(0, Math.min(1, frac)) * (rungs.length - 1))
  return rungs[i]
}

const HISTORY_WINDOW_DAYS = 90

/** The hardest rung of a ladder with a genuinely logged set in the last 90 days, if any. */
export function historyRungFor(S, pattern) {
  const ladder = LADDERS.find(l => l.key === pattern)
  if (!ladder) return null
  const cutoff = Date.now() - HISTORY_WINDOW_DAYS * 86400000
  let best = -1
  ;((S && S.workouts) || []).forEach(w => {
    const t = w.start || new Date(w.d + 'T12:00:00').getTime()
    if (t < cutoff) return
    ;(w.entries || []).forEach(e => {
      if (!(e.sets || []).some(x => x.done)) return
      const i = ladder.rungs.indexOf(e.id)
      if (i > best) best = i
    })
  })
  if (best < 0) return null
  // Clamp down to what the current kit reaches — history on rings does not help a profile
  // that has since said it only has a floor.
  const reachable = rungsFor(S, pattern)
  for (let i = best; i >= 0; i--) if (reachable.includes(ladder.rungs[i])) return ladder.rungs[i]
  return null
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
  // A loaded lift takes the slot when the kit exists: it progresses by weight, so it needs
  // no rep ceiling and no ladder — the plates are the ladder.
  const loaded = loadedFor(S, pattern)
  if (loaded && !(used && used.has(loaded))) {
    const g = goalOf(answers)
    const lex = EXIDX[loaded]
    const lside = /one arm|single arm|one leg|single leg/i.test(lex.n || '')
    return {
      id: loaded, sets: setsFor(slotIndex, answers), weight: 0, mode: 'reps',
      reps: lside ? g.reps[0] * 2 : g.reps[0],
      ...(lside ? { side: true } : {}),
    }
  }
  const rungs = rungsFor(S, pattern)
  if (!rungs.length) return null
  const first = pickRung(S, pattern, answers)
  // Do not repeat a movement inside one session; step along the ladder instead — to the
  // NEAREST unused rung, harder first, easier as the fallback. The old fallback took the
  // bottom of the ladder, which is how a barbell lifter's second push slot became wall
  // push-ups: an extra slot is more of the same work, not a regression to day one.
  let id = first
  if (used && used.has(id)) {
    const i = rungs.indexOf(id)
    id = rungs.find((r, j) => j > i && !used.has(r))
      || [...rungs.slice(0, Math.max(0, i))].reverse().find(r => !used.has(r))
      || null
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
  // Loaded options first: a dumbbell curl is strictly better than curling your own leg, and
  // reachableId silently skips it for anyone without the dumbbell.
  { muscle: 'biceps', ids: ['0294', '0031', '1769', '1770'] },   // DB curl, BB curl, then the floor improvisations
  { muscle: 'lower-back', ids: ['0489'] },                 // hyperextension
  { muscle: 'serratus', ids: ['3021'] },                   // scapula push-up
  // Only reachable with kit — on a bare floor these muscles stay in the "cannot train" list
  // rather than being papered over with wrist circles.
  { muscle: 'trapezius', ids: ['0406', '0095', '0604'] },  // DB shrug, BB shrug, lever shrug
  { muscle: 'forearm', ids: ['0401', '0126'] },            // DB wrist curl, BB wrist curl
  { muscle: 'deltoids', ids: ['0334'] },                   // DB lateral raise — the side delts pressing misses
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
  Object.keys(LOADED).forEach(k => { const id = loadedFor(S, k); if (id) out.push(id) })
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
    // Cardio conditioning blocks are not movement slots: they train no mapped muscle, so
    // counting them would raise the coverage bar without adding anything that could meet it.
    return n + (r ? r.ex.filter(e => (EXIDX[e.id] || {}).bp !== 'cardio').length : 0)
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

/**
 * Exercises that would most directly close a gap in one muscle, best first.
 *
 * Ties on directness break by how close a ladder rung sits to where this profile trains —
 * a stalled quad gap in a barbell plan should reach for a pistol-squat progression, not send
 * an experienced lifter back to a supported squat.
 */
export function fillersFor(S, muscle, answers) {
  const at = {}
  if (answers) LADDERS.forEach(l => {
    const want = pickRung(S, l.key, answers)
    l.rungs.forEach((id, i) => { at[id] = Math.abs(i - l.rungs.indexOf(want)) })
  })
  const scored = candidatePool(S)
    .map(id => ({ id, w: (loadOf([{ id, sets: 1 }])[muscle] || 0), d: at[id] ?? 0 }))
    .filter(x => x.w > 0)
    .sort((a, b) => (b.w - a.w) || (a.d - b.d))
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
  // Days the user can actually train, when they said so. Fewer available days than sessions
  // asked for is resolved in favour of reality — the plan trains the days that exist.
  const avail = Array.isArray(answers.availableDays) && answers.availableDays.length
    ? [...new Set(answers.availableDays)].filter(d => d >= 0 && d <= 6).sort((a, b) => a - b)
    : null
  let days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, answers.days || 3))
  const daysClamped = !!(avail && avail.length < days)
  if (daysClamped) days = Math.max(MIN_DAYS, avail.length)
  const slotCap = lengthOf(answers).slots
  const shape = avail ? chooseDays(avail, days) : weekShape(days)
  const keys = splitFor(days)
  const g = goalOf(answers)
  const inten = intensityOf(answers)
  const rirTarget = Math.max(0, Math.min(4, g.rir + inten.rirAdj))
  // A pattern is reachable through its ladder OR through a loaded lift — a machines-only
  // profile has no pull-up ladder but very much has a lat pulldown.
  const canTrain = pattern => rungsFor(S, pattern).length > 0 || !!loadedFor(S, pattern)

  const seen = {}
  let usedHistory = 0
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
      const target = canTrain(pattern) ? pattern : SUBSTITUTE[pattern]
      if (!target || !canTrain(target)) continue
      const cfg = buildSlot(S, target, ex.length, answers, used)
      if (cfg) {
        if (historyRungFor(S, target) === cfg.id) usedHistory++
        used.add(cfg.id); ex.push(cfg)
      }
    }
    return {
      id: uid(),
      name: seen[k] > 1 ? `${spec.name} ${seen[k]}` : spec.name,
      emoji: spec.emoji,
      prog: 'linear',
      // The effort the plan was built around, so the workout screen can show the same number
      // the preview promised instead of the two drifting apart.
      rir: rirTarget,
      ex,
    }
  })

  const week = {}
  shape.forEach((d, i) => { if (routines[i]) week[d] = routines[i].id })
  const trained = () => routines.filter(r => Object.values(week).includes(r.id))

  // ---- the fat-loss extras ----
  // Short rests are half of that goal's programming; the other half is a finisher and
  // supersets, both of which the app already supports and a plan should therefore use.
  let finisher = null
  if (answers.goal === 'lean' && reachableId(S, '1160')) {
    finisher = '1160'   // burpees, held for time — the honest floor-only conditioning block
    trained().forEach(r => {
      if (!r.ex.some(e => e.id === finisher)) {
        r.ex.push({ id: finisher, sets: 3, sec: 40, secMax: 75, weight: 0, mode: 'time', prog: 'time' })
      }
    })
  }

  // ---- audit and backfill ----
  // The check a person would do by eye on the muscle map, run before you ever see the plan.
  // Loops rather than making one pass: adding a movement changes the numbers, so the only way
  // to know a gap is closed is to measure again. Bounded by the fact that each pass either
  // adds something or gives up on that muscle.
  const filled = []
  // Accessories may stretch a session, never double it — and a conditioning finisher gives
  // its slot back, or it would crowd out the accessory that closes a real gap.
  const hardCap = Math.min(9, slotCap + 2) + (finisher ? 1 : 0)
  for (let pass = 0; pass < 6; pass++) {
    const gaps = coverageGaps(S, routines, week)
    if (!gaps.length) break
    let progressed = false
    for (const muscle of gaps) {
      const all = fillersFor(S, muscle, answers)
      if (!all.length) continue
      const already = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
      const fresh = all.filter(id => !already.has(id))
      const withRoom = trained().filter(r => r.ex.length < hardCap)
      // Same-muscle work concentrates: a second shrug goes next to the first, never into a
      // fresh session — and while a session already carrying this muscle exists, no new
      // session is opened for it at all, even if the carrier is full (the deepen path below
      // grows it in place instead). Spreading one muscle across three sessions is what makes
      // a week impossible to arrange without back-to-back repeats.
      const carrier = withRoom.find(r => r.ex.some(e => all.includes(e.id)))
      const hasCarrier = trained().some(r => r.ex.some(e => all.includes(e.id)))
      const target = carrier || (hasCarrier ? null : homeFor(muscle, withRoom))

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
      // A second session and no further: two carriers of a hard muscle can always be placed
      // with a rest between them, three cannot on a dense week.
      const carriers = trained().filter(r => r.ex.some(e => all.includes(e.id))).length
      const other = carriers >= 2 ? null
        : homeFor(muscle, trained().filter(r => r.ex.length < hardCap && !r.ex.some(e => all.includes(e.id))))
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

  // ---- put every session in coach order ----
  // Backfill appends and the finisher lands before backfill even runs, so by this point a
  // session can read "…burpees, then four calm sets of scapula push-ups". The order every
  // coach writes: main pattern work first (in the order the split chose), accessories after,
  // conditioning dead last. A stable sort, so nothing within a class ever reshuffles.
  // Runs before supersets, which pair *adjacent* entries and must see the final order.
  const ACCESSORY_IDS = new Set(ACCESSORIES.flatMap(a => a.ids))
  const orderClass = e => ((EXIDX[e.id] || {}).bp === 'cardio' ? 2 : ACCESSORY_IDS.has(e.id) ? 1 : 0)
  routines.forEach(r => {
    r.ex = r.ex.map((e, i) => [e, i]).sort((a, b) => (orderClass(a[0]) - orderClass(b[0])) || (a[1] - b[1])).map(x => x[0])
  })

  // ---- supersets, for the goal whose rest periods want them ----
  // Adjacent opposing pairs (a press with a pull) share a superset id, which is exactly the
  // structure the workout screen already knows how to run back-to-back. Never a timed hold,
  // never more than two pairs a session, and always adjacent — the sg contract.
  let supersets = 0
  if (answers.goal === 'lean') {
    const PRESS = ['push', 'vpush', 'dip']
    const PULLS = ['row', 'pull']
    trained().forEach(r => {
      let pairs = 0
      for (let i = 0; i + 1 < r.ex.length && pairs < 2; i++) {
        const a = r.ex[i], b = r.ex[i + 1]
        if (a.sg || b.sg || a.mode === 'time' || b.mode === 'time') continue
        const pa = patternKeyOf(a.id), pb = patternKeyOf(b.id)
        const opposing = (PRESS.includes(pa) && PULLS.includes(pb)) || (PULLS.includes(pa) && PRESS.includes(pb))
        if (!opposing) continue
        const sgId = 'sg' + uid()
        a.sg = sgId; b.sg = sgId
        pairs++; supersets++
      }
    })
  }

  // ---- who sleeps next to whom ----
  // The split decides what the sessions are; this decides which day each one lands on.
  // Once days are dense enough to touch, the same six sessions can be a clean week or a
  // chest-day pile-up depending purely on the ordering — so every assignment of sessions
  // to the chosen days is scored by how many hard, slow-recovering muscles consecutive
  // days share (the exact measure the Plan screen's Week check warns with, lib/week.js),
  // and the quietest arrangement wins. The plan must never trip its own checker. Sessions
  // are at most six, so brute force is cheap and deterministic; run after the backfill and
  // the finisher, because they change what a session hits.
  const dayList = Object.keys(week).map(Number).sort((a, b) => a - b)
  if (dayList.length > 2) {
    const adjacent = []   // index pairs in dayList that are consecutive calendar days (the week repeats, so it wraps)
    for (let i = 0; i < dayList.length; i++) {
      const j = (i + 1) % dayList.length
      if ((dayList[j] - dayList[i] + 7) % 7 === 1) adjacent.push([i, j])
    }
    if (adjacent.length) {
      const hard = new Map(routines.map(r => [r.id, hardMusclesOf(r)]))
      const score = order => adjacent.reduce((n, [i, j]) => n + sharedHard(hard.get(order[i]), hard.get(order[j])).length, 0)
      const ids = dayList.map(d => week[d])
      let best = ids, bestScore = score(ids)
      const walk = (order, rest) => {
        if (bestScore === 0) return
        if (!rest.length) {
          const sc = score(order)
          if (sc < bestScore) { best = order.slice(); bestScore = sc }
          return
        }
        for (let i = 0; i < rest.length; i++) walk([...order, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)])
      }
      if (bestScore > 0) walk([], ids)
      dayList.forEach((d, i) => { week[d] = best[i] })
    }
  }

  const load = weeklyLoad(routines, week)
  return {
    routines,
    week,
    report: {
      days,
      splitName: splitName(days),
      restWhy: avail
        ? 'Placed on the days you said you can train, spread as far apart as they allow.'
        : restWhy(days),
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
      rir: rirTarget,
      goalName: g.name,
      intensityName: inten.name,
      // How the week was placed and dressed — everything the preview needs to explain itself.
      pickedDays: !!avail,
      daysClamped,
      fromHistory: usedHistory,
      loadedCount: routines.reduce((n, r) => n + r.ex.filter(e => !!LOADED_PATTERN[e.id]).length, 0),
      supersets,
      finisher: finisher ? exOr(finisher).n : null,
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
