// The food log: pure functions over S.food, in the same shape as S.bodyweight.
//
// One entry is one thing you ate. It carries what it was, how much of it, and the four
// numbers — and, importantly, where those numbers came from. `src` is not decoration: a
// figure you typed off a packet and a figure a model guessed from a photo are different
// kinds of claim, and the app should never let them look identical.
//
// Everything here is a pure function of the log, matching how the training side works: no
// running totals stored anywhere, so correcting yesterday's lunch immediately corrects
// yesterday's total with nothing to migrate.

import { todayISO, uid } from './format.js'

// Atwater factors — the standard energy density of each macronutrient, in kcal per gram.
// Used only to sanity-check and to fill a missing calorie figure, never to overwrite one
// that came off a label.
export const KCAL_PER_G = { p: 4, c: 4, f: 9 }
export const MACROS = ['p', 'c', 'f']
export const MACRO_NAME = { p: 'Protein', c: 'Carbs', f: 'Fat' }

/** Where a number came from. Shown in the UI so an estimate never passes as a measurement. */
export const SOURCES = {
  manual: { label: 'Typed in', estimate: false },
  db: { label: 'Food database', estimate: false },
  ai: { label: 'AI estimate', estimate: true },
}
export const isEstimate = e => !!(e && SOURCES[e.src] && SOURCES[e.src].estimate)

const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0 }

/** Calories implied by the macros, for filling a gap or flagging a mismatch. */
export const kcalFromMacros = m =>
  Math.round(MACROS.reduce((n, k) => n + (Number(m && m[k]) || 0) * KCAL_PER_G[k], 0))

/**
 * Normalise anything on its way into the log — a typed form, a database hit, a model's JSON.
 * Everything downstream can then assume four finite non-negative numbers and a name.
 *
 * A missing calorie count is derived from the macros rather than left at zero, because an
 * entry worth zero calories silently under-reports the day; a calorie count that came with
 * the item is kept exactly as given, even when it disagrees with 4/4/9 (labels round, and
 * fibre and alcohol do not fit the three-macro model).
 */
export function normalizeEntry(raw, iso) {
  const e = raw || {}
  const macros = { p: num(e.p), c: num(e.c), f: num(e.f) }
  const kcal = num(e.kcal) || kcalFromMacros(macros)
  return {
    id: e.id || uid(),
    d: e.d || iso || todayISO(),
    t: e.t || Date.now(),
    n: String(e.n || '').trim().slice(0, 80) || 'Food',
    q: String(e.q || '').trim().slice(0, 40),
    kcal, ...macros,
    src: SOURCES[e.src] ? e.src : 'manual',
  }
}

/** Everything logged on one day, oldest first. */
export const dayFood = (S, iso) =>
  ((S && S.food) || []).filter(e => e.d === (iso || todayISO())).sort((a, b) => (a.t || 0) - (b.t || 0))

/** Sum a list of entries into the four numbers. */
export function totals(entries) {
  const out = { kcal: 0, p: 0, c: 0, f: 0 }
  ;(entries || []).forEach(e => {
    out.kcal += Number(e.kcal) || 0
    MACROS.forEach(k => { out[k] += Number(e[k]) || 0 })
  })
  out.kcal = Math.round(out.kcal)
  MACROS.forEach(k => { out[k] = Math.round(out[k] * 10) / 10 })
  return out
}

export const dayTotals = (S, iso) => totals(dayFood(S, iso))

/**
 * Share of the day's energy coming from each macro, 0–1.
 *
 * Computed against the energy the macros actually account for, not against the logged
 * calories: the two disagree whenever a label rounds or an entry has calories but no macro
 * breakdown, and a split that does not add up to 100 % reads as a bug.
 */
export function macroSplit(t) {
  const energy = MACROS.map(k => (Number(t && t[k]) || 0) * KCAL_PER_G[k])
  const sum = energy.reduce((a, b) => a + b, 0)
  const out = {}
  MACROS.forEach((k, i) => { out[k] = sum > 0 ? energy[i] / sum : 0 })
  return out
}

/** The target, or null where none is set. Every field is independently optional. */
export function targetOf(S) {
  const t = (S && S.foodTarget) || null
  if (!t) return null
  const out = {}
  if (num(t.kcal)) out.kcal = Math.round(num(t.kcal))
  MACROS.forEach(k => { if (num(t[k])) out[k] = Math.round(num(t[k])) })
  return Object.keys(out).length ? out : null
}

/** How much of each target is left today. Absent target fields come back undefined. */
export function remaining(S, iso) {
  const tgt = targetOf(S)
  if (!tgt) return null
  const got = dayTotals(S, iso)
  const out = {}
  Object.keys(tgt).forEach(k => { out[k] = Math.round((tgt[k] - got[k]) * 10) / 10 })
  return out
}

/**
 * A starting point for a protein target, from body weight.
 *
 * 1.6 g/kg is the low end of the range that resistance-training reviews converge on for
 * retaining and building muscle; going much above ~2.2 buys little. Offered as a suggestion
 * you can overwrite, never applied — the app does not know your goal, and a target it picked
 * for you is one you have no reason to trust.
 */
export const PROTEIN_G_PER_KG = 1.6
const LB_PER_KG = 2.20462
export function suggestProtein(S) {
  const bw = ((S && S.bodyweight) || []).slice(-1)[0]
  if (!bw || !(bw.w > 0)) return null
  const kg = (S.unit === 'lb') ? bw.w / LB_PER_KG : bw.w
  return Math.round(kg * PROTEIN_G_PER_KG)
}

/** Days that have any food logged, newest first — drives the day picker and the charts. */
export const foodDays = S => [...new Set(((S && S.food) || []).map(e => e.d))].sort().reverse()

/**
 * One point per day for the calories chart, oldest first. Days with nothing logged are left
 * out rather than drawn as zero — a day you forgot to log is not a day you ate nothing, and
 * plotting it as one drags the line into a story that never happened.
 */
export function kcalSeries(S, days) {
  const cutoff = days ? Date.now() - days * 86400000 : 0
  const byDay = {}
  ;((S && S.food) || []).forEach(e => { byDay[e.d] = (byDay[e.d] || 0) + (Number(e.kcal) || 0) })
  return Object.keys(byDay).sort()
    .map(d => ({ d, t: new Date(d + 'T12:00:00').getTime(), y: Math.round(byDay[d]) }))
    .filter(p => p.t > cutoff)
}

/** Mean daily calories over the days that were actually logged. */
export function avgKcal(S, days) {
  const pts = kcalSeries(S, days)
  if (!pts.length) return null
  return Math.round(pts.reduce((a, p) => a + p.y, 0) / pts.length)
}

/**
 * The things you actually eat, ranked — the answer to food logging's biggest friction, which
 * is retyping the same breakfast every day.
 *
 * Grouped by name (case-insensitive), most-often-logged first with recency as the tie-break,
 * and each group is represented by its most recent entry — the numbers you last corrected,
 * not the ones you first guessed. Source rides along: re-logging an AI estimate is still
 * logging an estimate.
 */
export function recentFoods(S, days = 45, limit = 8) {
  const cutoff = Date.now() - days * 86400000
  const groups = new Map()
  ;((S && S.food) || []).forEach(e => {
    if ((e.t || 0) < cutoff) return
    const k = String(e.n || '').toLowerCase().trim()
    if (!k) return
    const g = groups.get(k) || { n: 0, last: null }
    g.n++
    if (!g.last || (e.t || 0) > (g.last.t || 0)) g.last = e
    groups.set(k, g)
  })
  return [...groups.values()]
    .sort((a, b) => (b.n - a.n) || ((b.last.t || 0) - (a.last.t || 0)))
    .slice(0, limit)
    .map(g => ({ n: g.last.n, q: g.last.q, kcal: g.last.kcal, p: g.last.p, c: g.last.c, f: g.last.f, src: g.last.src, times: g.n }))
}

/** Copy one day's log onto another (inside store.update). Fresh ids, fresh timestamps. */
export function copyDay(s, fromIso, toIso) {
  const from = dayFood(s, fromIso)
  // d must be stripped as well as id/t — normalizeEntry keeps any date the entry carries,
  // and a copy that keeps yesterday's date is a duplicate, not a copy.
  from.forEach(e => addFood(s, { ...e, id: undefined, t: undefined, d: undefined }, toIso))
  return from.length
}

/**
 * Body-weight movement across the same window a calorie average covers — the pairing that
 * makes the average mean something. First and last weigh-ins inside the window; null when
 * there are not two to compare.
 */
export function weightChangeOver(S, days) {
  const cutoff = days ? Date.now() - days * 86400000 : 0
  const pts = ((S && S.bodyweight) || []).filter(b => (b.t || new Date(b.d).getTime()) > cutoff)
  if (pts.length < 2) return null
  return Math.round((pts[pts.length - 1].w - pts[0].w) * 10) / 10
}

/* ---- mutations, all called inside store.update ---- */
export function addFood(s, raw, iso) {
  s.food = s.food || []
  const e = normalizeEntry(raw, iso)
  s.food.push(e)
  return e
}
export function removeFood(s, id) { s.food = (s.food || []).filter(e => e.id !== id) }
export function updateFood(s, id, patch) {
  const i = (s.food || []).findIndex(e => e.id === id)
  if (i >= 0) s.food[i] = normalizeEntry({ ...s.food[i], ...patch, id }, s.food[i].d)
}
