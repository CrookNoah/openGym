// The nudge ladder — a workout reminder that does not give up after one polite ping.
//
// The old reminder fired once, at a fixed morning time, and was ignored by lunchtime. This
// is the version that knows the shape of a day: you get home from work, you sit down, and
// the session on the plan quietly becomes tomorrow's problem. So the ladder starts when you
// are usually home, opens friendly and plan-aware ("Pull day — back and biceps are
// waiting"), and gets one rung meaner every hour you leave it. It goes quiet at bedtime, it
// never says a word on a rest day, and the moment a workout is logged the rest of the day's
// rungs are cancelled.
//
// Three things keep it honest rather than obnoxious:
//
//   · Tone is chosen, not assumed. "Encouraging" is three gentle rungs; "Push me" is five
//     blunt ones; "Full send" is seven and genuinely swears at you at the top. That last one
//     is opt-in and never a default — an app that swears at someone who didn't ask for it is
//     just an app they uninstall.
//   · A wrong guess is one tap to fix. The home time is a guess about your life, so every
//     notification carries a "Not home" button: tapping it pushes the rest of today's ladder
//     back an hour instead of pretending you're ignoring it.
//   · It remembers. Duck the same planned weekday twice running and the next ladder skips
//     the pleasantries and starts a tier in — and says so, so it reads as being known rather
//     than being randomly nastier.
//
// There is no server in the mobile build, so nothing can evaluate "did he train?" at fire
// time — every rung has to be scheduled in advance. Hence the shape of this file: one pure
// function, state + clock in, the exact list of notifications out. The native layer
// (lib/mobile.js) does nothing but cancel the old set and schedule this one, and the store
// re-runs it after every state change — which is what makes "workout started → the rest of
// today goes away" fall out for free rather than needing its own plumbing.

import { isoOf, DAYN } from './format.js'
import { effectiveRoutineId } from './history.js'
import { missedPlanned, routineMuscles } from './week.js'
import { MUSCLE_NAME } from './muscles.js'
import { t } from './i18n.js'

/** Native notification ids reserved for the ladder — see mobile.js. */
export const NUDGE_ID_BASE = 200
export const NUDGE_ID_MAX = 200 + 7 * 10   // 7 days × up to 10 rungs
// Outside that range on purpose: the Settings preview is a one-shot that must survive the
// next resync's blanket cancel long enough to actually arrive.
export const NUDGE_PREVIEW_ID = 199

/** The "Not home" button, and the action type the notifications are tagged with. */
export const NUDGE_ACTION_TYPE = 'nudge'
export const NOT_HOME_ACTION = 'nothome'

/**
 * The ladders, one per tone. Array length is the rung count *and* the escalation depth:
 * a tone that never gets nasty also stops nagging sooner, which is the whole point of
 * picking it. Bodies take {0} = the session's name, {1} = the muscles it trains.
 */
export const LADDERS = {
  kind: [
    { title: 'Workout day', body: '{0} today — {1} are waiting. Twenty minutes is enough.' },
    { title: 'Still time', body: 'Nothing logged yet. Even a short {0} beats skipping it.' },
    { title: 'Last chance today', body: 'One set of anything keeps the week alive.' },
  ],
  push: [
    { title: 'Workout day', body: '{0} today. {1} are waiting — let’s go.' },
    { title: 'Still nothing', body: 'An hour gone and {0} hasn’t moved.' },
    { title: 'Two hours', body: 'Still no {0}. The plan is not going to do itself.' },
    { title: 'Running out of day', body: 'You planned this. {1} are still waiting. Go.' },
    { title: 'Last call', body: 'Do one set of {0}, or call today what it is — a skip.' },
  ],
  full: [
    { title: 'Workout day', body: '{0} today. {1} are waiting — let’s go.' },
    { title: 'Clock’s running', body: 'An hour and no {0}. Get up.' },
    { title: 'Two hours gone', body: 'Still nothing. {1} are sat there waiting on you.' },
    { title: 'Seriously?', body: 'Three hours of pretending you’re busy. You’re not. {0}. Now.' },
    { title: 'Get up', body: 'Off the sofa. {1}. It takes twenty minutes and you know it.' },
    { title: 'No more excuses', body: 'Do the bloody workout. {0}. Nobody is coming to do it for you.' },
    { title: 'Last call', body: 'Four hours of shit excuses. Do the fucking workout or stop calling it a plan.' },
  ],
}

export const TONES = ['kind', 'push', 'full']
export const TONE_NAME = { kind: 'Encouraging', push: 'Push me', full: 'Full send' }
export const TONE_HINT = {
  kind: 'Three gentle nudges, then it leaves you alone.',
  push: 'Five rungs, blunt by the end. No swearing.',
  full: 'Seven rungs, closer together so it reaches the end.',
}

export const DEF_NUDGE = { on: false, home: '17:30', quiet: '22:00', tone: 'push', notHome: null }

// An hour between rungs is the cadence the ladder is written for. It compresses — never
// below half an hour — when the tone has more rungs than the evening has hours: a tone whose
// whole point is where it *ends* is a broken promise if bedtime arrives at rung four. So
// "Full send" on a normal evening runs about every three quarters of an hour, and the
// sharpest thing it has to say actually gets said.
const MAX_GAP = 60
const MIN_GAP = 30

/**
 * The minutes-past-midnight each rung fires at, for a window and a rung count. Rungs that
 * cannot fit before bedtime are simply not there — a short evening buys you fewer nags,
 * which is honest, and nudgeSummary says so out loud rather than promising five and firing
 * two.
 */
export function ladderTimes(home, quiet, count) {
  if (count < 1) return []
  const span = quiet - home - 1
  const gap = count > 1 ? Math.max(MIN_GAP, Math.min(MAX_GAP, Math.floor(span / (count - 1)))) : MAX_GAP
  const out = []
  for (let i = 0; i < count; i++) {
    const at = home + i * gap
    if (at >= quiet || at >= 1440) break
    out.push(at)
  }
  return out
}

/**
 * A stored 'HH:MM' as the phone would write it — so the sentence under the switch reads in
 * the same clock as the time pickers above it, rather than quoting 17:30 at someone whose
 * picker says 5:30 PM. Deliberately the *device* locale, not the app language: that is what
 * <input type="time"> renders in, and agreeing with the control beside it matters more here
 * than agreeing with the paragraph around it.
 */
export function fmtClock(hhmm) {
  const m = minsOf(hhmm, null)
  if (m == null) return hhmm
  try {
    return new Date(2000, 0, 1, Math.floor(m / 60), m % 60)
      .toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch (e) { return hhmm }
}

/** '17:30' → 1050 minutes past midnight. Bad input falls back rather than scheduling at NaN. */
export function minsOf(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return fallback
  const mm = Number(m[1]) * 60 + Number(m[2])
  return mm >= 0 && mm < 1440 ? mm : fallback
}

const cfgOf = S => ({ ...DEF_NUDGE, ...((S && S.nudge) || {}) })

/** The muscles a session is about, as a phrase: "back and biceps". */
function musclePhrase(routine) {
  const ms = routineMuscles(routine, 2).map(m => t(MUSCLE_NAME[m]))
  if (!ms.length) return t('your muscles')
  return ms.length === 1 ? ms[0] : t('{0} and {1}', ms[0], ms[1])
}

/**
 * Weekdays that have earned a meaner opening: the same planned day ducked twice running.
 * missedPlanned already does the careful part — it respects day overrides, ignores people
 * who are simply away, and refuses to judge a schedule for weeks before it existed.
 */
export const grudgeDays = S => missedPlanned(S, 2)

/**
 * Every notification the ladder wants scheduled over the next `days` days.
 *
 * Pure: same state and same clock, same list — which is what makes the whole feature
 * testable without a phone. Returns [] whenever it should stay silent, which is most of
 * the time: switched off, nothing planned, already trained, past bedtime.
 *
 * Each entry is { id, iso, weekday, rung, tier, at, title, body } with `at` in epoch ms.
 */
export function nudgeLadder(S, now = Date.now(), days = 7) {
  const cfg = cfgOf(S)
  if (!cfg.on || !S) return []
  const rungs = LADDERS[cfg.tone] || LADDERS.push
  const home = minsOf(cfg.home, minsOf(DEF_NUDGE.home))
  const quiet = minsOf(cfg.quiet, minsOf(DEF_NUDGE.quiet))
  const routines = S.routines || []
  const trained = new Set((S.workouts || []).map(w => w.d))
  const grudge = grudgeDays(S)
  const out = []

  for (let k = 0; k < days; k++) {
    const dt = new Date(now)
    dt.setHours(12, 0, 0, 0)
    dt.setDate(dt.getDate() + k)
    const iso = isoOf(dt)
    const weekday = dt.getDay()
    // A day is only naggable if a session is actually planned for it — day overrides
    // included, so a week rescheduled by hand is respected rather than argued with.
    const rid = effectiveRoutineId(S, iso)
    const routine = rid && routines.find(r => r.id === rid)
    if (!routine) continue
    // Already done (or being done right now) — today has nothing left to say.
    if (trained.has(iso)) continue
    if (k === 0 && S.active && S.active.d === iso) continue

    // "Not home" pushes the rest of the day back an hour per tap. It only ever applies to
    // the day it was tapped on; tomorrow starts from the usual time again.
    const deferred = cfg.notHome && cfg.notHome.d === iso ? Math.max(0, Number(cfg.notHome.by) || 0) : 0
    // Grudge: skip the friendly opener entirely. The ladder is shorter and meaner, and the
    // first message says why — being remembered, not just randomly shouted at.
    const base = grudge.includes(weekday) ? 1 : 0
    const name = routine.name
    const muscles = musclePhrase(routine)
    // Deferring shortens the evening rather than restructuring it: the ladder starts an hour
    // later at the same cadence, and whatever no longer fits before bedtime simply goes.
    const times = ladderTimes(home + deferred * 60, quiet, rungs.length - base)

    for (let i = 0; i < times.length; i++) {
      const r = base + i
      const when = new Date(dt)
      when.setHours(0, Math.round(times[i]), 0, 0)
      const ms = when.getTime()
      if (ms <= now) continue
      const msg = rungs[r]
      let body = t(msg.body, name, muscles)
      if (base && r === base) body = t('Second {0} running you have ducked. Starting where we left off.', t(DAYN[weekday])) + ' ' + body
      out.push({
        id: NUDGE_ID_BASE + k * 10 + i,
        iso, weekday, rung: i, tier: r, at: ms,
        title: t(msg.title), body,
      })
    }
  }
  return out
}

/**
 * The sharpest thing the chosen tone will ever say, ready to be fired as a real
 * notification from Settings. "Full send swears at you" is a claim; letting someone read it
 * on their own lock screen before they live with it is the honest version — and it proves
 * the OS will actually deliver these while you are there to see it fail. Null when the plan
 * is empty, because a preview needs a session to be about.
 */
export function nudgePreview(S) {
  const cfg = cfgOf(S)
  const rungs = LADDERS[cfg.tone] || LADDERS.push
  const msg = rungs[rungs.length - 1]
  const routines = (S && S.routines) || []
  const scheduled = Object.values((S && S.week) || {})
  const r = routines.find(x => scheduled.includes(x.id)) || routines[0]
  if (!r) return null
  return { title: t(msg.title), body: t(msg.body, r.name, musclePhrase(r)) }
}

/** "Not home" — inside store.update. Pushes the rest of `iso` back an hour. */
export function deferToday(s, iso) {
  const cur = s.nudge && s.nudge.notHome && s.nudge.notHome.d === iso ? Number(s.nudge.notHome.by) || 0 : 0
  s.nudge = { ...DEF_NUDGE, ...(s.nudge || {}), notHome: { d: iso, by: cur + 1 } }
}

/**
 * One sentence describing what tonight looks like, for the Settings footer — the honest
 * answer to "what did I just switch on?", written from the same numbers that schedule it.
 */
export function nudgeSummary(S) {
  const cfg = cfgOf(S)
  if (!cfg.on) return null
  const rungs = (LADDERS[cfg.tone] || LADDERS.push).length
  const home = minsOf(cfg.home, minsOf(DEF_NUDGE.home))
  const quiet = minsOf(cfg.quiet, minsOf(DEF_NUDGE.quiet))
  const fit = ladderTimes(home, quiet, rungs).length
  if (!fit) return t('Nothing fits between {0} and {1} — move one of them.', fmtClock(cfg.home), fmtClock(cfg.quiet))
  return t('On days with a session planned: {0} reminders from {1}, getting sharper each time, silent after {2}. Logging a workout stops them, and “Not home” pushes them back an hour.',
    fit, fmtClock(cfg.home), fmtClock(cfg.quiet))
}
