// When the app should suggest an easy week, rather than wait to be told.
//
// The easy week (lib/progression.js) is deliberate deloading — but a switch nobody knows
// they need is a switch nobody flips. The signals that say "you need one" are already in the
// log; this file just reads them out:
//
//   1. Weeks trained without a break — an unbroken streak of training weeks, with no easy
//      week inside it. Hard training only works with breaks in it, and past six straight
//      weeks the break is overdue whether or not anything has stalled yet.
//   2. Concurrent stalls — one exercise missing its targets is a plateau; several missing at
//      once is fatigue. The per-exercise engine only ever sees one lift at a time, so this
//      is the one read it cannot make for itself.
//   3. Effort creep — the same training rated closer to failure than it was a fortnight ago.
//      Only measurable for people who rate sets, and only spoken when both windows hold
//      enough ratings to mean something.
//
// Two signals together, or a long streak on its own, earn the suggestion. It is a card with
// a "not now", never an action: the engine prescribes numbers, people decide weeks.

import { streakWeeks, lastEntryFor } from './history.js'
import { sessionsFor, stallCount, easyWeekActive } from './progression.js'
import { rirOf } from './effort.js'
import { todayISO } from './format.js'

const WEEKS_SOFT = 6      // part of a two-signal case
const WEEKS_HARD = 8      // enough on its own
const STALLED_MIN = 2     // exercises stalling at once
const CREEP_RIR = 0.8     // how much closer to failure counts as drift
const CREEP_MIN_SETS = 6  // rated sets each window needs before the comparison is honest
const SNOOZE_DAYS = 14    // how long "not now" holds
const AFTER_EASY_DAYS = 21 // no nagging right after a deload

/** Exercises in the current plan whose recent sessions keep missing their targets. */
export function stalledCount(S) {
  const ids = [...new Set(((S && S.routines) || []).flatMap(r => (r.ex || []).map(e => e.id)))]
  let n = 0
  ids.forEach(id => {
    const cfg = (S.routines || []).flatMap(r => r.ex || []).find(e => e.id === id)
    if (stallCount(sessionsFor(S, id, cfg)) >= 2 && lastEntryFor(S, id)) n++
  })
  return n
}

/** Mean RIR of rated, done, non-warm-up sets inside a day window ending `endDaysAgo` ago. */
function windowRir(S, fromDays, toDays) {
  const now = Date.now()
  const lo = now - fromDays * 86400000, hi = now - toDays * 86400000
  const vals = []
  ;((S && S.workouts) || []).forEach(w => {
    const t = w.start || new Date(w.d + 'T12:00:00').getTime()
    if (t < lo || t > hi) return
    ;(w.entries || []).forEach(e => (e.sets || []).forEach(s => {
      if (!s.done || s.wu) return
      const r = rirOf(s)
      if (r != null) vals.push(r)
    }))
  })
  return vals.length >= CREEP_MIN_SETS ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/**
 * Should the app suggest an easy week, and why — { suggest, reasons } with reasons as
 * translatable [template, ...args] pairs. Empty reasons when there is nothing to say.
 */
export function suggestEasyWeek(S, now = Date.now()) {
  if (!S || easyWeekActive(S)) return { suggest: false, reasons: [] }
  // Just finished one, or said "not now" — the suggestion holds its tongue for a while.
  const since = iso => iso ? (now - new Date(iso + 'T12:00:00').getTime()) / 86400000 : Infinity
  if (since(S.easyUntil) < AFTER_EASY_DAYS) return { suggest: false, reasons: [] }
  if (since(S.fatigueDismissed) < SNOOZE_DAYS) return { suggest: false, reasons: [] }

  // A completed easy week resets the clock: deload sessions are still logged workouts, so
  // the raw streak sails straight through them — clamp to the weeks since the deload ended,
  // or the card returns three weeks after every easy week forever.
  const sinceEasy = S.easyUntil
    ? Math.max(0, Math.floor((now - new Date(S.easyUntil + 'T12:00:00').getTime()) / (7 * 86400000)))
    : Infinity
  const weeks = Math.min(streakWeeks(S), sinceEasy)
  const stalled = stalledCount(S)
  const recent = windowRir(S, 14, 0)
  const before = windowRir(S, 28, 14)
  const creep = recent != null && before != null && before - recent >= CREEP_RIR

  const reasons = []
  if (weeks >= WEEKS_SOFT) reasons.push(['{0} straight weeks of training', weeks])
  if (stalled >= STALLED_MIN) reasons.push(['{0} exercises stalling at once', stalled])
  if (creep) reasons.push(['the same training is being rated closer to failure than two weeks ago'])

  return { suggest: reasons.length >= 2 || weeks >= WEEKS_HARD, reasons }
}

/** "Not now", remembered — inside store.update. */
export function dismissEasyWeek(s) { s.fatigueDismissed = todayISO() }
