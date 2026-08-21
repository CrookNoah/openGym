// Reading the week the user actually has.
//
// The plan wizard audits the week it generates — measures weekly effective sets per muscle,
// names what is light and what the kit cannot reach — and then never looks again. But plans
// are edited: an exercise swapped, a day dropped, a routine written from scratch. This file
// points the same coverage engine (lib/planner.js) at S.week + S.routines as they stand, so
// a hand-edited plan is held to the same standard as a generated one, live, on the Plan
// screen rather than only in a preview that scrolled away.

import { MUSCLES, loadOfRoutine, rankOf, hardMusclesOf, sharedHard } from './muscles.js'
import { weeklyLoad, thresholds, weekSlotCount, fillersFor, homeFor, accessoryCfg, DEFAULT_ANSWERS } from './planner.js'
import { modeOf, effectiveRoutineId } from './history.js'
import { exOr } from './exercises.js'
import { isoOf } from './format.js'

/**
 * Weekdays whose planned session keeps not happening — the plan asking to be moved.
 *
 * A weekday counts when its last `lookback` occurrences were all planned (day overrides
 * respected: a week rescheduled to rest is handled, not missed) and none got a workout
 * logged — while the user is otherwise active (trained within a fortnight), because
 * "you keep missing Mondays" said to someone on holiday is just nagging. Occurrences
 * older than the history itself never count: a plan younger than the window is innocent.
 */
export function missedPlanned(S, lookback = 3) {
  const workouts = (S && S.workouts) || []
  if (!workouts.length) return []
  const lastT = new Date(workouts[workouts.length - 1].d + 'T12:00:00').getTime()
  if (Date.now() - lastT > 14 * 86400000) return []
  // A schedule is only guilty for the weeks it existed. weekEdited is stamped whenever the
  // week template changes; profiles from before the stamp fall back to the history's start,
  // which at least protects imported histories with a brand-new plan on top.
  const born = (S && S.weekEdited)
    ? new Date(S.weekEdited + 'T12:00:00').getTime()
    : new Date(workouts[0].d + 'T12:00:00').getTime()
  const firstT = Math.max(born, new Date(workouts[0].d + 'T12:00:00').getTime())
  const done = new Set(workouts.map(w => w.d))
  const out = []
  for (let d = 0; d < 7; d++) {
    if (!((S.week || {})[d])) continue
    let missed = 0
    for (let k = 0; k < lookback; k++) {
      const dt = new Date(); dt.setHours(12, 0, 0, 0)
      const delta = ((dt.getDay() - d + 7) % 7) || 7   // most recent PAST occurrence of weekday d
      dt.setDate(dt.getDate() - delta - k * 7)
      if (dt.getTime() < firstT) { missed = 0; break }
      const iso = isoOf(dt)
      if (effectiveRoutineId(S, iso) == null) { missed = 0; break }
      if (done.has(iso)) { missed = 0; break }
      missed++
    }
    if (missed >= lookback) out.push(d)
  }
  return out
}

/**
 * What a session costs in minutes, honestly approximate: each rep-set is ~3 s a rep
 * (clamped 20–60 s — nobody's set of five takes fifteen seconds), a timed set is its
 * prescribed hold, cardio is its own clock with no rest rows, and the profile's rest
 * setting sits between every set but the last. A warm-up set counts as one more set.
 * The wizard asks "about how long?" — this is the number that answers whether the plan
 * it built actually keeps that promise.
 */
export function sessionMinutes(r, restSec = 90) {
  const rest = Number(restSec) > 0 ? Number(restSec) : 90
  let work = 0, sets = 0
  ;(r?.ex || []).forEach(c => {
    const n = (c.sets || 1) + (c.warmup ? 1 : 0)
    const mode = modeOf(c)
    if (mode === 'cardio') { work += n * (c.min || 20) * 60; return }
    sets += n
    work += n * (mode === 'time' ? (c.sec || 45) : Math.min(60, Math.max(20, (c.reps || 10) * 3)))
  })
  return Math.round((work + Math.max(0, sets - 1) * rest) / 60)
}

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

/**
 * The one-tap fix for a Week check gap — the generator's own backfill, offered on demand.
 *
 * A diagnosis without a cure is homework: the audit already knows which movement most
 * directly trains a missed muscle (fillersFor), which session it belongs in (homeFor), and
 * how the generator's own concentration rule works (join the session that already carries
 * the muscle; open a new one only when none does). Returns what it *would* do, so the UI
 * can put a sentence and a button in front of it:
 *   { kind:'add', cfg, name, routine }        — add this configured exercise to that routine
 *   { kind:'deepen', name, routine, entryId } — one more set of what is already there
 *   null                                      — nothing this kit can reach helps
 */
export function repairFor(S, muscle) {
  const routines = (S && S.routines) || []
  const week = (S && S.week) || {}
  const trained = routines.filter(r => Object.values(week).includes(r.id))
  if (!trained.length) return null
  const answers = (S && S.plannerAnswers) || DEFAULT_ANSWERS
  const all = fillersFor(S, muscle, answers)
  if (!all.length) return null
  // "Already in the plan" means the *scheduled* plan: a filler sitting in an archived,
  // unscheduled routine trains nothing this week and must not block the fix. And sessions
  // have a ceiling here just as they do in the generator — repeated one-tap fixes must not
  // quietly build a 14-exercise Tuesday.
  const ROOM = 10
  const already = new Set(trained.flatMap(r => r.ex.map(e => e.id)))
  const fresh = all.filter(id => !already.has(id))
  const withRoom = trained.filter(r => r.ex.length < ROOM)
  const carrier = withRoom.find(r => r.ex.some(e => all.includes(e.id)))
  if (fresh.length && (carrier || withRoom.length)) {
    const target = carrier || homeFor(muscle, withRoom)
    const cfg = accessoryCfg(S, fresh[0], target.ex.length, answers)
    if (cfg) return { kind: 'add', cfg, name: exOr(cfg.id).n, routine: target }
  }
  const deep = trained.flatMap(r => r.ex.map(e => ({ r, e }))).find(x => all.includes(x.e.id) && (x.e.sets || 1) < 5)
  if (deep) return { kind: 'deepen', name: exOr(deep.e.id).n, routine: deep.r, entryId: deep.e.id }
  return null
}

/** Apply a repair, inside store.update. */
export function applyRepair(s, rep) {
  const r = (s.routines || []).find(x => x.id === rep.routine.id)
  if (!r) return
  if (rep.kind === 'add') r.ex.push({ ...rep.cfg })
  else {
    const e = r.ex.find(x => x.id === rep.entryId)
    if (e) e.sets = (e.sets || 1) + 1
  }
}

/**
 * Adjacent scheduled days that hammer the same muscles.
 *
 * "Hammer" is judged by hardMusclesOf (lib/muscles.js): primary work only, on muscles that
 * actually need a night off — assistance work and daily-trainable muscles (abs, calves…)
 * never trigger it, because a normal Push→Pull week is not a problem and saying it is
 * teaches people to ignore the warning. One genuinely shared hard muscle is enough: chest
 * on two consecutive days is the thing a rest day exists to prevent.
 *
 * The generator scores its own output against this exact function before choosing which
 * session lands on which day, so a generated plan arrives clean; this fires for the weeks
 * people drag together by hand. Days are weekday indexes (0 = Sunday), checked circularly —
 * the week repeats, so Saturday into Sunday counts.
 */
export function adjacentOverlap(S) {
  const routines = (S && S.routines) || []
  const week = (S && S.week) || {}
  const cache = new Map()   // a routine scheduled on several days is scored once
  const hardOf = rid => {
    if (!cache.has(rid)) {
      const r = routines.find(x => x.id === rid)
      cache.set(rid, r ? { r, ...hardMusclesOf(r) } : null)
    }
    return cache.get(rid)
  }
  const out = []
  for (let d = 0; d < 7; d++) {
    const next = (d + 1) % 7
    if (!week[d] || !week[next]) continue
    const a = hardOf(week[d]), b = hardOf(week[next])
    if (!a || !b) continue
    const shared = sharedHard(a, b)
    if (shared.length) out.push({ day: d, next, a: a.r, b: b.r, shared })
  }
  return out
}
