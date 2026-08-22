// The goal: one thing the whole app can point at.
//
// Before this, "my goal" was three unrelated pieces of state — a target weight that drew a
// line on a chart, a training goal that shaped the plan, and a calorie target computed once
// and never revisited. Nothing tied them together and nothing ever checked whether the goal
// was actually happening. This file is the missing middle: a real goal object, an honest
// read of whether you are on course, and a proposal when you are not.
//
// Two ideas do most of the work here.
//
// **Trend, not the scale.** Body weight swings a kilo or two a day on water, salt, glycogen
// and gut contents. A verdict computed from your last two weigh-ins is a verdict about
// noise, and that is precisely why weight apps feel like they are lying to you. So the
// number this file reports is an exponentially-weighted moving average, and the *rate* it
// judges you on is a least-squares slope across a multi-week window — the estimator that
// uses every point rather than the two most flattering ones.
//
// **Diagnose before prescribing.** When the scale stops moving, the lazy move is to cut
// calories again. But the app has the food log and the workout history, so it can check
// something better first: were you actually hitting the target? Cutting someone's calories
// on the strength of two logged days out of seven is not coaching, it is arithmetic applied
// to bad data. proposeAdjustment therefore returns a *diagnosis* — sometimes "log a full
// week and ask me again", sometimes "you ate above target five days out of seven", and only
// when the plan was genuinely followed does it offer a smaller number.
//
// Everything is a pure function of state and clock, so the whole thing is testable without
// a phone, and the notification layer is one dumb mirror of it.

import { isoOf, todayISO, DAYN } from './format.js'
import { t } from './i18n.js'
import { dayFood, targetOf } from './food.js'
import { effectiveRoutineId } from './history.js'
import { kgOf } from './setup.js'

/* ============================ the goal ============================ */

/**
 * S.goal — absent until one is set, which is the app's normal "absent means off".
 *
 *   kind      'lose' | 'gain' | 'maintain'
 *   startW    weight when the goal began, in S.unit — the anchor progress is measured from
 *   startD    the day it began
 *   targetW   where it is going (null for maintain)
 *   rate      planned change per week, in S.unit, always positive
 *   baseKcal  the calorie target the goal started with, so drift can be capped
 *   adjustments  [{ d, from, to }] — every change, with the day it happened
 *   weighTime    when the morning weigh-in prompt fires
 *   dismissed    day the check-in card was last dismissed
 */
export const DEF_GOAL_TIME = '07:30'

export const goalOf = S => (S && S.goal && S.goal.kind ? S.goal : null)
export const hasGoal = S => !!goalOf(S)

/* ============================ trend ============================ */

// Half-life of the smoother, in days. Eight days is long enough to swallow a salty dinner
// and a bad night's sleep, short enough that a fortnight of real progress is visible.
const HALF_LIFE_DAYS = 8
// Below these, the app says "not yet" instead of inventing a verdict. Ten days and four
// weigh-ins is roughly where the slope stops being dominated by day-to-day water.
const MIN_SPAN_DAYS = 10
const MIN_POINTS = 4
// The window the rate is measured over. Three weeks: long enough to be a trend, short
// enough to notice a stall while it is still worth fixing.
const RATE_WEEKS = 3

const dayMs = 86400000
const tOf = b => (b && b.t) || new Date(b.d + 'T12:00:00').getTime()

/**
 * The weigh-in series with an EWMA trend attached: [{ d, t, w, trend }], oldest first.
 *
 * Gap-aware, because people do not weigh in every day: the smoothing factor is derived from
 * how long it has been since the last reading, so a week's silence lets the next number
 * count for more, exactly as it should.
 */
export function trendSeries(S) {
  const bw = ((S && S.bodyweight) || []).filter(b => b && b.w > 0).slice().sort((a, b) => tOf(a) - tOf(b))
  let trend = null, prevT = null
  return bw.map(b => {
    const time = tOf(b)
    if (trend == null) trend = b.w
    else {
      const gap = Math.max(0, (time - prevT) / dayMs)
      const alpha = 1 - Math.pow(0.5, gap / HALF_LIFE_DAYS)
      trend += (b.w - trend) * alpha
    }
    prevT = time
    return { d: b.d, t: time, w: b.w, trend: Math.round(trend * 100) / 100 }
  })
}

/** The smoothed weight right now — what the goal card shows, with the raw number secondary. */
export function trendWeight(S) {
  const s = trendSeries(S)
  return s.length ? s[s.length - 1].trend : null
}

/**
 * Change per week over the last `weeks`, by least squares on the raw weigh-ins.
 *
 * Regression rather than "first minus last over time": every reading gets a vote, so one
 * unlucky morning at either end of the window cannot rewrite the verdict. Null when the
 * window does not hold enough readings across enough days to mean anything — the honest
 * answer to "am I on track" after four days is "ask me on Friday".
 */
export function trendRate(S, weeks = RATE_WEEKS, now = Date.now()) {
  const lo = now - weeks * 7 * dayMs
  const pts = trendSeries(S).filter(p => p.t >= lo)
  if (pts.length < MIN_POINTS) return null
  const span = (pts[pts.length - 1].t - pts[0].t) / dayMs
  if (span < MIN_SPAN_DAYS) return null
  // x in days from the first point, y in S.unit.
  const n = pts.length
  const mx = pts.reduce((a, p) => a + (p.t - pts[0].t) / dayMs, 0) / n
  const my = pts.reduce((a, p) => a + p.w, 0) / n
  let num = 0, den = 0
  pts.forEach(p => {
    const x = (p.t - pts[0].t) / dayMs - mx
    num += x * (p.w - my)
    den += x * x
  })
  if (!den) return null
  return (num / den) * 7   // per week
}

/* ============================ progress ============================ */

/**
 * Where the goal stands: { startW, now, targetW, done, toGo, pct, weeksIn, rate, etaWeeks }.
 * `now` is the trend weight, never the raw scale — progress is a trajectory, not a morning.
 */
export function goalProgress(S, now = Date.now()) {
  const g = goalOf(S)
  if (!g) return null
  const cur = trendWeight(S)
  if (cur == null) return null
  const rate = trendRate(S, RATE_WEEKS, now)
  const weeksIn = Math.max(0, (now - new Date(g.startD + 'T12:00:00').getTime()) / (7 * dayMs))
  const total = g.targetW != null ? Math.abs(g.targetW - g.startW) : 0
  const done = g.kind === 'gain' ? cur - g.startW : g.startW - cur
  const toGo = g.targetW != null ? (g.kind === 'gain' ? g.targetW - cur : cur - g.targetW) : 0
  // Progress can go negative — three weeks in and up two pounds is real, and a bar clamped
  // to zero would hide it.
  const pct = total > 0 ? Math.max(-1, Math.min(1, done / total)) : 0
  // ETA from the rate you are actually moving at, not the rate you planned. Null when the
  // rate is unknown, or pointing the wrong way, because a countdown that assumes success is
  // the most dishonest number a weight app can show.
  const moving = rate != null && (g.kind === 'gain' ? rate > 0 : rate < 0)
  const etaWeeks = moving && toGo > 0 ? Math.ceil(toGo / Math.abs(rate)) : null
  return { startW: g.startW, now: cur, targetW: g.targetW, done: Math.round(done * 10) / 10,
    toGo: Math.round(Math.max(0, toGo) * 10) / 10, total, pct, weeksIn, rate, etaWeeks }
}

/* ============================ the verdict ============================ */

// How far off the planned rate still counts as on track. Weight loss is not a metronome;
// ±40% of plan is a normal fortnight, and calling that "behind" trains people to ignore it.
const ON_TRACK_LO = 0.6
const ON_TRACK_HI = 1.6
// Below this share of plan the scale is effectively still.
const STALL_SHARE = 0.2
// Faster than this share of body weight per week starts costing muscle rather than fat.
const TOO_FAST_PCT = 0.011

export const VERDICTS = ['early', 'ontrack', 'ahead', 'behind', 'stalled', 'wrong', 'done']

/**
 * Are you on course? { state, rate, planned, confident } where state is one of VERDICTS.
 *
 * 'early' is a real answer, not a fallback: under ten days and four weigh-ins there is
 * nothing here but water, and saying so is more useful than a confident guess.
 */
export function paceVerdict(S, now = Date.now()) {
  const g = goalOf(S)
  if (!g) return null
  const p = goalProgress(S, now)
  if (!p) return { state: 'early', rate: null, planned: g.rate, confident: false }
  if (g.targetW != null && p.toGo <= 0) return { state: 'done', rate: p.rate, planned: g.rate, confident: true }
  if (p.rate == null) return { state: 'early', rate: null, planned: g.rate, confident: false }

  const planned = Math.abs(g.rate) || 0
  // Signed so that "progress" is always positive, whichever way the goal points.
  const moved = g.kind === 'gain' ? p.rate : -p.rate
  if (g.kind === 'maintain') {
    const drift = Math.abs(p.rate) / Math.max(0.1, p.now * 0.004)
    return { state: drift > 1 ? 'wrong' : 'ontrack', rate: p.rate, planned, confident: true }
  }
  if (!planned) return { state: 'ontrack', rate: p.rate, planned, confident: true }

  const share = moved / planned
  const tooFast = p.now > 0 && Math.abs(p.rate) / p.now > TOO_FAST_PCT
  let state
  if (moved < 0) state = 'wrong'
  else if (share < STALL_SHARE) state = 'stalled'
  else if (share < ON_TRACK_LO) state = 'behind'
  else if (share > ON_TRACK_HI || tooFast) state = 'ahead'
  else state = 'ontrack'
  return { state, rate: p.rate, planned, confident: true, tooFast: state === 'ahead' && tooFast }
}

/* ============================ adherence ============================ */

/**
 * Was the plan actually followed this week? { loggedDays, avgKcal, target, overBy,
 * sessionsPlanned, sessionsDone }.
 *
 * This exists so the app can tell "the plan is wrong" apart from "the plan did not happen",
 * which are the two completely different problems behind an identical flat line.
 */
export function adherence(S, days = 7, now = Date.now()) {
  const tgt = targetOf(S)
  const kcalTarget = tgt && tgt.kcal > 0 ? tgt.kcal : null
  let loggedDays = 0, kcalSum = 0, sessionsPlanned = 0, sessionsDone = 0
  const done = new Set(((S && S.workouts) || []).map(w => w.d))
  // effectiveRoutineId reads S.dayPlan and S.routines directly, and this is called from the
  // coach's snapshot, which must survive a half-built profile.
  const plan = { dayPlan: (S && S.dayPlan) || {}, routines: (S && S.routines) || [], week: (S && S.week) || {} }
  for (let k = 1; k <= days; k++) {
    const dt = new Date(now); dt.setHours(12, 0, 0, 0); dt.setDate(dt.getDate() - k)
    const iso = isoOf(dt)
    const kcal = dayFood(S, iso).reduce((n, e) => n + (Number(e.kcal) || 0), 0)
    if (kcal > 0) { loggedDays++; kcalSum += kcal }
    if (effectiveRoutineId(plan, iso)) sessionsPlanned++
    if (done.has(iso)) sessionsDone++
  }
  const avgKcal = loggedDays ? Math.round(kcalSum / loggedDays) : null
  return {
    loggedDays, avgKcal, target: kcalTarget, sessionsPlanned, sessionsDone,
    overBy: avgKcal != null && kcalTarget ? avgKcal - kcalTarget : null,
  }
}

/* ============================ the adjustment ============================ */

// One step, and never a big one — 150 kcal is enough to move a stalled trend inside a
// fortnight and small enough that it does not wreck a day of eating.
const STEP_KCAL = 150
// However long this goes on, the target may not drift more than this from where it started.
// Without a cap, "stalled again, cut again" walks someone into a crash diet one polite tap
// at a time.
const MAX_DRIFT = 500
// Enough logged days for the food log to be evidence rather than an anecdote.
const MIN_LOGGED = 4
// The hard floor for an *adjusted* target, deliberately lower than the setup engine's
// recommendation floor (24 kcal/kg). They answer different questions: setup asks "how
// aggressive a cut should we ever propose to start with", which should be conservative;
// this asks "how low may a target ever go", which has to leave room for a legitimate
// aggressive cut without becoming a crash diet. Twenty kcal per kilo is that line, and
// MAX_DRIFT below is the real safety net anyway.
const FLOOR_PER_KG = 20
// Eating this far over target is the explanation, and no smaller target fixes it.
const OVER_SHARE = 0.08

/**
 * What to do about a goal that is not moving — a diagnosis, not automatically a number.
 *
 * Returns null when there is nothing to say, otherwise { kind, ... }:
 *   'log'    — too few logged days to judge; the fix is data
 *   'eat'    — logged honestly and eating over target; the fix is adherence
 *   'train'  — sessions are being missed; the fix is showing up
 *   'kcal'   — followed properly and still stalled; here is a smaller target { from, to }
 *   'floor'  — stalled, but the target is already as low as this app will go
 */
export function proposeAdjustment(S, now = Date.now()) {
  const g = goalOf(S)
  if (!g || g.kind === 'maintain') return null
  const v = paceVerdict(S, now)
  if (!v || !v.confident) return null
  if (!['behind', 'stalled', 'wrong'].includes(v.state)) return null
  const a = adherence(S, 7, now)
  if (a.loggedDays < MIN_LOGGED) return { kind: 'log', loggedDays: a.loggedDays }
  if (a.target && a.overBy != null && a.overBy > a.target * OVER_SHARE) {
    return { kind: 'eat', avgKcal: a.avgKcal, target: a.target, overBy: Math.round(a.overBy) }
  }
  if (a.sessionsPlanned >= 2 && a.sessionsDone < Math.ceil(a.sessionsPlanned * 0.6)) {
    return { kind: 'train', done: a.sessionsDone, planned: a.sessionsPlanned }
  }
  if (!a.target) return null
  const dir = g.kind === 'gain' ? 1 : -1
  const base = g.baseKcal || a.target
  const to = a.target + dir * STEP_KCAL
  // Recomputed at the weight you are at now — a cut that was safe twenty pounds ago is not
  // automatically safe today.
  const bw = trendWeight(S)
  const floor = bw > 0 ? Math.round(kgOf(bw, S.unit) * FLOOR_PER_KG / 50) * 50 : 0
  const drifted = Math.abs(to - base) > MAX_DRIFT
  if (dir < 0 && (to < floor || drifted)) return { kind: 'floor', target: a.target, floor }
  if (dir > 0 && drifted) return { kind: 'floor', target: a.target, floor }
  return { kind: 'kcal', from: a.target, to, delta: dir * STEP_KCAL }
}

/** Take the offered step — inside store.update. */
export function applyAdjustment(s, adj) {
  if (!adj || adj.kind !== 'kcal') return
  const cur = s.foodTarget || {}
  const ratio = adj.from > 0 ? adj.to / adj.from : 1
  s.foodTarget = {
    ...cur,
    kcal: adj.to,
    // Protein is the one macro that must not shrink with the target: it is what keeps the
    // muscle while the deficit takes the fat. Carbs and fat absorb the change instead.
    p: cur.p || null,
    c: cur.c ? Math.round(cur.c * ratio) : null,
    f: cur.f ? Math.round(cur.f * ratio) : null,
  }
  s.goal = { ...(s.goal || {}), adjustments: [...((s.goal || {}).adjustments || []), { d: todayISO(), from: adj.from, to: adj.to }] }
}

/* ============================ starting one ============================ */

// A first target of 10% of body weight: enough to matter (the share the health literature
// keeps finding real benefit at), few enough weeks that it stays believable.
export const GOAL_SHARES = [0.05, 0.1, 0.15]
export const DEFAULT_SHARE = 0.1
// Weekly change as a share of body weight. 0.6% is the middle of the band that holds onto
// muscle; the top of the band starts costing it.
const LOSE_RATE_PCT = 0.006
const GAIN_RATE_PCT = 0.0025

/**
 * The goal the app would propose: a complete one, not a blank field.
 * { kind, startW, targetW, rate, weeks, etaISO } — or null without a weigh-in to build on.
 */
export function recommendGoal(S, kind = 'lose', share = DEFAULT_SHARE, now = Date.now()) {
  const bw = trendWeight(S) || (((S && S.bodyweight) || []).slice(-1)[0] || {}).w
  if (!(bw > 0)) return null
  if (kind === 'maintain') return { kind, startW: bw, targetW: null, rate: 0, weeks: null, etaISO: null }
  const delta = Math.round(bw * share * 10) / 10
  const targetW = Math.round((kind === 'gain' ? bw + delta : bw - delta) * 10) / 10
  const rate = Math.round(bw * (kind === 'gain' ? GAIN_RATE_PCT : LOSE_RATE_PCT) * 100) / 100
  const weeks = rate > 0 ? Math.ceil(delta / rate) : null
  const eta = new Date(now); eta.setDate(eta.getDate() + (weeks || 0) * 7)
  return { kind, startW: bw, targetW, rate, weeks, etaISO: weeks ? isoOf(eta) : null }
}

/** Begin a goal — inside store.update. Anchors it at today so progress is measurable. */
export function startGoal(s, g) {
  const iso = todayISO()
  s.goal = {
    kind: g.kind, startW: g.startW, startD: iso, targetW: g.targetW, rate: g.rate,
    baseKcal: (s.foodTarget || {}).kcal || null,
    adjustments: [], weighTime: (s.goal || {}).weighTime || DEF_GOAL_TIME, dismissed: null,
  }
  s.targetW = g.targetW || null   // keeps the existing chart goal line in step
}

/** Stop — inside store.update. The weigh-ins stay; only the goal goes. */
export function clearGoal(s) { s.goal = null }

/* ============================ reminders ============================ */

/** Native notification ids reserved for the goal — see mobile.js. */
export const GOAL_ID_BASE = 400
export const GOAL_ID_MAX = 400 + 7 * 2 + 2

/** Days since the last weigh-in — what the morning prompt escalates on. */
export function daysSinceWeighIn(S, now = Date.now()) {
  const s = trendSeries(S)
  if (!s.length) return Infinity
  return Math.floor((now - s[s.length - 1].t) / dayMs)
}

// The morning prompt, sharper the longer the scale goes untouched. Index is days missed,
// clamped — a person four days in and a person twelve days in are the same person.
const WEIGH_LINES = [
  { title: 'Morning weigh-in', body: 'Same time, same scale, before breakfast. It takes ten seconds.' },
  { title: 'No weigh-in yesterday', body: 'One reading is noise; the run of them is the answer. Step on.' },
  { title: 'Two days off the scale', body: 'I cannot tell you if this is working while the data has holes in it.' },
  { title: 'Still no weigh-in', body: 'Three mornings skipped. Avoiding the number does not change the number.' },
]

/**
 * The goal's notifications for the next `days` days: a morning weigh-in prompt (skipped on
 * days already weighed) and the weekly check-in. Same contract as every other notification
 * engine here — pure, exhaustive, silent when there is nothing to say.
 */
export function goalReminders(S, now = Date.now(), days = 7) {
  const g = goalOf(S)
  if (!g || !S.nudge || !S.nudge.on) return []
  const weighed = new Set(((S && S.bodyweight) || []).map(b => b.d))
  const [h, m] = String(g.weighTime || DEF_GOAL_TIME).split(':').map(Number)
  const missed = daysSinceWeighIn(S, now)
  const out = []
  for (let k = 0; k < days; k++) {
    const dt = new Date(now); dt.setHours(12, 0, 0, 0); dt.setDate(dt.getDate() + k)
    const iso = isoOf(dt)
    if (k === 0 && weighed.has(iso)) continue
    const when = new Date(dt); when.setHours(h || 7, m || 30, 0, 0)
    // Future days cannot know whether they will be weighed on, so they get the gentle
    // opener; the resync each morning replaces it with the escalated line if it is earned.
    const tier = Math.min(WEIGH_LINES.length - 1, k === 0 ? Math.max(0, missed) : 0)
    if (when.getTime() > now) {
      out.push({
        id: GOAL_ID_BASE + k * 2, iso, kind: 'weigh', at: when.getTime(),
        title: t(WEIGH_LINES[tier].title), body: t(WEIGH_LINES[tier].body),
      })
    }
    // The check-in: Sunday, an hour after the weigh-in prompt, so the week's last reading
    // is already in when the verdict is written.
    if (dt.getDay() === 0) {
      const c = new Date(dt); c.setHours((h || 7) + 1, m || 30, 0, 0)
      if (c.getTime() > now) {
        out.push({
          id: GOAL_ID_BASE + k * 2 + 1, iso, kind: 'checkin', at: c.getTime(),
          title: t('Your week'), body: t('Seven days in. Here is what the trend says.'),
        })
      }
    }
  }
  return out
}

/* ============================ saying it ============================ */

/**
 * The verdict as a translatable [template, ...args] pair — one sentence, honest about
 * uncertainty. The AI weekly review (lib/coach.js) writes the long version; this is what
 * shows with no API key, and what the review is checked against.
 */
export function verdictLine(S, now = Date.now()) {
  const g = goalOf(S)
  const v = paceVerdict(S, now)
  const p = goalProgress(S, now)
  if (!g || !v) return null
  const u = S.unit || 'lb'
  const rate = v.rate != null ? Math.abs(Math.round(v.rate * 100) / 100) : null
  switch (v.state) {
    case 'done': return ['You hit it. {0} {1} down — now the job is keeping it.', Math.abs(p.done), u]
    case 'early': return ['Still gathering — weigh in daily and there will be a real answer within a fortnight.']
    case 'ontrack': return ['On track: {0} {1} a week, right where the plan wants you.', rate, u]
    case 'ahead': return v.tooFast
      ? ['Faster than planned — {0} {1} a week. That pace starts costing muscle, not just fat.', rate, u]
      : ['Ahead of plan at {0} {1} a week.', rate, u]
    case 'behind': return ['Moving, but slower than planned — {0} {1} a week against {2}.', rate, u, g.rate]
    case 'stalled': return ['The trend has been flat for a fortnight.']
    case 'wrong': return ['The trend is going the wrong way — up {0} {1} a week.', rate, u]
    default: return null
  }
}

/** The day name a weekday index refers to, for the review's prose. */
export const dayName = d => t(DAYN[d])
