// Body measurements: pure functions over S.measurements, the tape-measure companion to
// S.bodyweight.
//
// The scale tells you what changed; the tape tells you *where*. On a recomposition — losing
// fat while gaining muscle — the scale can sit still for months while the waist shrinks and
// the arms grow, and someone reading weight alone concludes nothing is happening. That is
// the exact person a home training app is for.
//
// One entry is one site on one day: { id, d, t, k, v }. A flat dated list like the food log,
// so it syncs, exports and merges with everything else and never needs a migration. Values
// are stored as typed, in whatever unit the profile was in — the same numbers-are-never-
// converted rule the weight log follows, because silently rescaling someone's history is
// worse than trusting them to keep using the same tape.

import { todayISO, uid } from './format.js'

// The sites a tape measure can actually find twice. Ordered top to bottom, which is also the
// order a measuring session naturally runs in. Sides are not split: a tape measurement is
// noisy enough (±1 cm between two honest attempts) that a left/right delta would mostly
// chart measurement error, and one number per site keeps logging fast enough to happen.
export const SITES = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'biceps', 'thigh', 'calf']
export const SITE_NAME = {
  neck: 'Neck', shoulders: 'Shoulders', chest: 'Chest', waist: 'Waist',
  hips: 'Hips', biceps: 'Biceps', thigh: 'Thigh', calf: 'Calf',
}

/** The length unit this profile measures in, riding on the weight unit it already chose. */
export const lenUnit = S => ((S && S.unit) === 'lb' ? 'in' : 'cm')

// Girths in cm run from a wrist (~15) to a chest (~130); the same range in inches. Anything
// outside is a typo, and rejecting it beats charting it.
const MAX_V = { cm: 250, in: 100 }
export const validMeasure = (v, unit) => {
  const n = Number(v)
  return isFinite(n) && n > 0 && n <= (MAX_V[unit] || MAX_V.cm)
}

const norm = v => Math.round(Number(v) * 10) / 10

/**
 * Write one measuring session (inside store.update). `vals` is { site: value } with any
 * subset of SITES filled in — nobody measures all eight every time, and an absent site must
 * stay absent rather than becoming a zero. Re-measuring a site on the same day corrects the
 * entry instead of stacking a duplicate, same as the weight log.
 */
export function addMeasures(s, vals, iso) {
  const d = iso || todayISO()
  const unit = lenUnit(s)
  s.measurements = s.measurements || []
  let n = 0
  SITES.forEach(k => {
    if (!vals || !validMeasure(vals[k], unit)) return
    const v = norm(vals[k])
    const ex = s.measurements.find(m => m.d === d && m.k === k)
    if (ex) { ex.v = v; ex.t = Date.now() }
    else s.measurements.push({ id: uid(), d, t: Date.now(), k, v })
    n++
  })
  return n
}

export function removeMeasure(s, id) {
  s.measurements = (s.measurements || []).filter(m => m.id !== id)
}

/** Every entry for one site, oldest first — the shape the charts want. */
export const siteSeries = (S, k) =>
  (((S && S.measurements) || []).filter(m => m.k === k))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t || 0) - (b.t || 0)))
    .map(m => ({ t: m.t || new Date(m.d + 'T12:00:00').getTime(), y: m.v, d: m.d, id: m.id }))

/** Latest value for a site, or null. */
export function lastOf(S, k) {
  const pts = siteSeries(S, k)
  return pts.length ? pts[pts.length - 1] : null
}

/** Movement since the previous measurement of the same site, or null with fewer than two. */
export function siteDelta(S, k) {
  const pts = siteSeries(S, k)
  if (pts.length < 2) return null
  return Math.round((pts[pts.length - 1].y - pts[pts.length - 2].y) * 10) / 10
}

/** The sites this profile has ever measured, in SITES order — drives what the card shows. */
export const measuredSites = S =>
  SITES.filter(k => (((S && S.measurements) || []).some(m => m.k === k)))
