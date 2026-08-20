// What new equipment actually changes about your training.
//
// Ticking a pull-up bar in Settings used to do one thing: widen the exercise library. That is
// the smaller half of the answer. The bigger half is that a bar unlocks a whole movement
// pattern — vertical pulling — that a floor cannot train at all, and until it appears in a
// routine it is not being trained either. This works out which patterns just became reachable
// and where in your week they belong.
//
// It only ever proposes. Rewriting somebody's plan because they ticked a checkbox is exactly
// the kind of thing the progression engine refuses to do with weights, and the reasoning is
// the same: the app can see what is now possible, but not whether you want it.

import { LADDERS, rungsFor } from './ladders.js'
import { EXIDX, exOr } from './exercises.js'
import { defaultConfig } from './history.js'
import { isHeldRung } from './ladders.js'

// Which half of the body a pattern belongs to, so a new pulling movement lands in the day
// that already does pulling rather than on leg day.
export const PATTERN_GROUP = {
  push: 'upper', vpush: 'upper', dip: 'upper', row: 'upper', pull: 'upper',
  squat: 'lower', hinge: 'lower', calf: 'lower',
  core: 'core', legraise: 'core',
}

/** Ladder keys this profile can train at all, given its kit. */
export const reachablePatterns = S =>
  LADDERS.filter(l => rungsFor(S, l.key).length > 0).map(l => l.key)

/**
 * Patterns that `after` can train and `before` could not.
 *
 * Both arguments are gear lists (the `S.gear` shape), not whole states, so this can be asked
 * about a change that has not been saved yet — which is what the settings sheet needs.
 */
export function newlyUnlocked(before, after) {
  const was = new Set(reachablePatterns({ gear: before || [] }))
  return reachablePatterns({ gear: after || [] }).filter(k => !was.has(k))
}

/**
 * The routine a new movement belongs in: whichever already does the most work in the same
 * half of the body. A tie, or a plan with nothing comparable in it, falls to the shortest
 * routine — adding to the emptiest day is the least disruptive guess available.
 */
export function bestRoutineFor(S, patternKey, ladderOfFn) {
  const routines = S.routines || []
  if (!routines.length) return null
  const group = PATTERN_GROUP[patternKey]
  const score = r => (r.ex || []).filter(e => {
    const pos = ladderOfFn(e.id)
    return pos && PATTERN_GROUP[pos.ladder.key] === group
  }).length
  let best = null, bestScore = -1
  routines.forEach(r => {
    const s = score(r)
    if (s > bestScore || (s === bestScore && best && (r.ex || []).length < (best.ex || []).length)) {
      best = r; bestScore = s
    }
  })
  return best
}

/**
 * What to offer after a kit change: one entry-level exercise per newly reachable pattern,
 * already configured, with the routine it would join.
 *
 * The easiest reachable rung, deliberately — buying a bar does not make you able to do a
 * one-arm chin-up, and a first session that cannot be finished is the fastest way to stop
 * using the new equipment.
 */
export function proposeAdditions(S, before, after, ladderOfFn) {
  const next = { ...S, gear: after }
  return newlyUnlocked(before, after).map(key => {
    const rungs = rungsFor(next, key)
    const id = rungs[0]
    if (!id || !EXIDX[id]) return null
    const routine = bestRoutineFor(next, key, ladderOfFn)
    if (!routine) return null
    // Already in that routine — nothing to offer.
    if ((routine.ex || []).some(e => e.id === id)) return null
    const ladder = LADDERS.find(l => l.key === key)
    const mode = isHeldRung(id) ? 'time' : 'reps'
    const base = defaultConfig(id, mode)
    const cfg = mode === 'time'
      ? { ...base, id, sets: 3, sec: 20, secMax: 60, prog: 'time' }
      : { ...base, id, sets: 3, reps: 5, repsMax: 12 }
    return { pattern: key, ladderName: ladder ? ladder.name : key, id, name: exOr(id).n, routineId: routine.id, routineName: routine.name, cfg }
  }).filter(Boolean)
}

/** Apply chosen proposals to a draft state (call inside store.update). */
export function applyAdditions(s, picks) {
  picks.forEach(p => {
    const r = (s.routines || []).find(x => x.id === p.routineId)
    if (!r || r.ex.some(e => e.id === p.id)) return
    r.ex.push({ ...p.cfg })
  })
}
