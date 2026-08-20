// Variation ladders — how bodyweight training actually progresses.
//
// A barbell lift progresses by adding a plate. A push-up cannot: once you can do six sets
// of twenty, more reps is not more stimulus, it is more evening. What you do instead is
// change the *leverage* — the same movement made harder by hand position, elevation, or
// taking a limb away. The progression engine already knows it has run out of road (it says
// "time to add weight or move to a harder variation"); this is the file that can finish the
// sentence, because it knows which variation.
//
// A ladder is one movement pattern, its rungs ordered easiest → hardest. Rungs are real ids
// from the exercise dataset, so every one of them arrives with an animation, instructions
// and a muscle mapping already. Rungs you have no kit for are stepped over rather than
// removed: buy a pull-up bar and the pulling ladders grow new rungs above the ones you have
// been doing, with your history intact underneath.

import { EXIDX, exOr } from './exercises.js'
import { gearOf, hasGear } from './gear.js'

// Rungs that are a *position*, not a rep count — an L-sit or a handstand is held. Levelling
// up into one switches the exercise to time mode, or the app would ask for 10 reps of a
// hold. Everything else stays in whatever mode it was already logged in.
export const HELD_RUNGS = new Set(['3302', '3419', '3296', '3239', '3665', '0464'])

export const LADDERS = [
  {
    key: 'push', name: 'Push-up',
    rungs: ['0659', '0493', '3211', '0662', '0259', '0279', '0283', '3294', '0725', '3327'],
  },
  {
    key: 'vpush', name: 'Overhead push',
    rungs: ['0279', '3662', '3302', '0471'],
  },
  {
    key: 'dip', name: 'Dip',
    rungs: ['3287', '0815', '1399', '0129', '0251', '2462', '3288', '0677', '0639'],
  },
  {
    key: 'row', name: 'Horizontal pull',
    rungs: ['3166', '3165', '3158', '3168', '3162', '3156', '0499', '0808'],
  },
  {
    key: 'pull', name: 'Pull-up',
    rungs: ['0499', '0688', '1326', '0652', '1429', '3418', '3293', '0638'],
  },
  {
    key: 'squat', name: 'Squat',
    rungs: ['3132', '3119', '3470', '2368', '1489', '0514', '1476', '1759'],
  },
  {
    key: 'hinge', name: 'Hip hinge',
    rungs: ['3013', '1422', '3561', '3645', '0696', '3193'],
  },
  {
    key: 'core', name: 'Core hold',
    rungs: ['3239', '3665', '0464', '3419', '3296'],
  },
  {
    key: 'legraise', name: 'Leg raise',
    rungs: ['0872', '0865', '0689', '2802', '0472', '0475'],
  },
  {
    key: 'calf', name: 'Calf raise',
    rungs: ['1373', '1490', '1387', '1386'],
  },
]

// exId → [{ ladder, i }]. An id can sit on two ladders (a decline push-up is the top of the
// horizontal ladder and the bottom of the overhead one), so the index holds every position
// and the callers pick.
const INDEX = {}
LADDERS.forEach(l => l.rungs.forEach((id, i) => { (INDEX[id] = INDEX[id] || []).push({ ladder: l, i }) }))

/** Every ladder position this exercise occupies, or [] if it is not on one. */
export const ladderPositions = exId => INDEX[exId] || []

/**
 * The one position to progress along.
 *
 * A few exercises genuinely belong to two patterns — a decline push-up is near the top of
 * the horizontal press ladder and the bottom of the overhead one — and the app has to pick
 * one. It picks whichever leaves the most rungs above you, so an exercise you have not
 * finished growing out of never reports itself as a dead end.
 */
export function ladderOf(exId) {
  const pos = ladderPositions(exId)
  if (!pos.length) return null
  return pos.reduce((best, p) =>
    (p.ladder.rungs.length - 1 - p.i) > (best.ladder.rungs.length - 1 - best.i) ? p : best)
}

export const isOnLadder = exId => !!INDEX[exId]

// Rungs are skipped, not dropped, when the kit is missing: the ladder is a fact about the
// movement, availability is a fact about your flat.
const reachable = (S, id) => !!EXIDX[id] && hasGear(S, gearOf(EXIDX[id]))

/** The next harder variation you can actually do, or null at the top of the ladder. */
export function nextRung(S, exId) {
  const pos = ladderOf(exId)
  if (!pos) return null
  for (let i = pos.i + 1; i < pos.ladder.rungs.length; i++) {
    const id = pos.ladder.rungs[i]
    if (reachable(S, id)) return id
  }
  return null
}

/** The next easier variation you can do — for regressing after a stall. */
export function prevRung(S, exId) {
  const pos = ladderOf(exId)
  if (!pos) return null
  for (let i = pos.i - 1; i >= 0; i--) {
    const id = pos.ladder.rungs[i]
    if (reachable(S, id)) return id
  }
  return null
}

/**
 * Where you stand, counting only the rungs you can reach — "step 3 of 6" has to mean three
 * of the six you could actually train, or a floor-only profile reads its own progress
 * against a ladder half of which needs a pull-up bar.
 */
export function ladderPos(S, exId) {
  const pos = ladderOf(exId)
  if (!pos) return null
  const avail = pos.ladder.rungs.filter(id => reachable(S, id))
  const step = avail.indexOf(exId)
  return { name: pos.ladder.name, key: pos.ladder.key, step: step + 1, total: avail.length, atTop: step === avail.length - 1 }
}

/** The rungs of one ladder this profile can train, easiest first. */
export const rungsFor = (S, key) => {
  const l = LADDERS.find(x => x.key === key)
  return l ? l.rungs.filter(id => reachable(S, id)) : []
}

/**
 * Where this profile stands on every ladder it has ever trained — the data behind the
 * Stats card that answers "am I actually getting anywhere?" for training without a bar
 * to put more plates on.
 *
 * "Where you stand" is the most recently trained rung, not the hardest ever touched: the
 * ladder is a statement about what you do now, and someone who tried one muscle-up in June
 * and has done regular pull-ups since stands at pull-ups. Step counts run over reachable
 * rungs only (same rule as ladderPos); a current rung whose kit has since gone away still
 * counts the reachable rungs at or below it, so the position stays honest instead of
 * disappearing.
 */
export function ladderProgress(S) {
  const lastTrained = new Map() // exId → most recent workout time with a done set
  ;((S && S.workouts) || []).forEach(w => {
    const when = w.start || new Date(w.d + 'T12:00:00').getTime()
    ;(w.entries || []).forEach(e => {
      if (!e.sets || !e.sets.some(s => s.done)) return
      if ((lastTrained.get(e.id) || 0) < when) lastTrained.set(e.id, when)
    })
  })
  return LADDERS.map(l => {
    let cur = null, curT = 0
    l.rungs.forEach(id => {
      const when = lastTrained.get(id)
      if (when && when >= curT) { cur = id; curT = when }
    })
    if (!cur) return null
    const avail = l.rungs.filter(id => reachable(S, id))
    const idx = l.rungs.indexOf(cur)
    const step = avail.filter(id => l.rungs.indexOf(id) <= idx).length
    return {
      key: l.key, name: l.name, id: cur,
      step, total: avail.length, atTop: step >= avail.length && avail.length > 0,
      when: curT,
    }
  }).filter(Boolean)
}

/** Display name for a rung id, resolving through the placeholder so it can never throw. */
export const rungName = id => exOr(id).n

/** Does levelling up into this rung mean switching to a timed hold? */
export const isHeldRung = id => HELD_RUNGS.has(id)
