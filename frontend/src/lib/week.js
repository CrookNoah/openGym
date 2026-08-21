// Reading the week the user actually has.
//
// The plan wizard audits the week it generates — measures weekly effective sets per muscle,
// names what is light and what the kit cannot reach — and then never looks again. But plans
// are edited: an exercise swapped, a day dropped, a routine written from scratch. This file
// points the same coverage engine (lib/planner.js) at S.week + S.routines as they stand, so
// a hand-edited plan is held to the same standard as a generated one, live, on the Plan
// screen rather than only in a preview that scrolled away.

import { MUSCLES, loadOfRoutine, rankOf } from './muscles.js'
import { weeklyLoad, thresholds, weekSlotCount } from './planner.js'

/** The muscles one routine trains, hardest-worked first — the chips on the today card. */
export function routineMuscles(routine, n = 5) {
  const { worked } = rankOf(loadOfRoutine(routine))
  return worked.slice(0, n)
}

/**
 * The wizard's coverage audit, on the real week. Null when nothing is scheduled — an empty
 * plan has no coverage to speak of, and rendering fifteen failures over it would just be
 * shouting at a blank page.
 *
 * `light` and `missed` split the same worst-first gap list the generator backfills from:
 * light muscles get *some* work and sit under the bar, missed ones get none at all. The bar
 * itself is the honest one — scaled to what the kit can directly train and to how much
 * training the week contains (see thresholds() in lib/planner.js).
 */
export function weekAudit(S) {
  const routines = (S && S.routines) || []
  const week = (S && S.week) || {}
  const slots = weekSlotCount(routines, week)
  if (!slots) return null
  const load = weeklyLoad(routines, week)
  const th = thresholds(S, slots)
  // The same worst-first ordering as coverageGaps, computed from the load and thresholds
  // already in hand rather than calling it and re-deriving all three — this runs on every
  // Plan-screen render, not once per generated plan.
  const gaps = Object.keys(th)
    .filter(m => (load[m] || 0) < th[m])
    .sort((a, b) => (1 - (load[b] || 0) / th[b]) - (1 - (load[a] || 0) / th[a]))
  return {
    slots, load, th,
    light: gaps.filter(m => (load[m] || 0) > 0),
    missed: gaps.filter(m => !((load[m] || 0) > 0)),
    untrainable: MUSCLES.filter(m => !(m in th)),
  }
}

// One session's worth of effective sets that makes a muscle "trained hard that day". Two
// primary sets, or five secondary ones — below that a shared muscle between two days is
// assistance work, not a recovery problem.
const HEAVY_SETS = 2

/**
 * Adjacent scheduled days that hammer the same muscles.
 *
 * The generator spaces sessions so this never happens to a plan it built; dragging the week
 * around by hand can put two heavy pressing days back to back without anything saying so.
 * A pair is flagged when consecutive calendar days each give two or more effective sets to
 * two or more of the same muscles — one shared muscle is normal (everything shares a core),
 * two trained hard is the same session twice with no night's sleep between doing any good.
 *
 * Days are weekday indexes (0 = Sunday), checked circularly so Saturday → Sunday counts.
 */
export function adjacentOverlap(S) {
  const routines = (S && S.routines) || []
  const week = (S && S.week) || {}
  const cache = new Map()   // a routine scheduled on several days is scored once
  const heavyOf = rid => {
    if (cache.has(rid)) return cache.get(rid)
    const r = routines.find(x => x.id === rid)
    const out = r ? { r, l: loadOfRoutine(r), heavy: null } : null
    if (out) out.heavy = MUSCLES.filter(m => (out.l[m] || 0) >= HEAVY_SETS)
    cache.set(rid, out)
    return out
  }
  const out = []
  for (let d = 0; d < 7; d++) {
    const next = (d + 1) % 7
    if (!week[d] || !week[next]) continue
    const a = heavyOf(week[d]), b = heavyOf(week[next])
    if (!a || !b) continue
    const shared = a.heavy.filter(m => b.l[m] >= HEAVY_SETS)
      .sort((x, y) => (a.l[y] + b.l[y]) - (a.l[x] + b.l[x]))
    if (shared.length >= 2) out.push({ day: d, next, a: a.r, b: b.r, shared })
  }
  return out
}
