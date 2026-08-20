// Open Food Facts — the free half of food logging.
//
// An open, crowd-sourced database of packaged food with no API key, no account and no quota,
// which is the only reason it is in an app that promises none of those things. It is strong
// on anything with a barcode and weak on "a bowl of rice", so it is one way in among several
// rather than the way in.
//
// Parsing is kept separate from fetching so the mapping — which is where the bugs live — is
// testable without a network. Nutrition in OFF is per 100 g; the caller scales.

const BASE = 'https://world.openfoodfacts.org'
// OFF asks every client to identify itself so they can contact you about a misbehaving one.
const UA = 'openGym/1.0 (https://github.com/DuarteSantos8/openGym)'

const num = v => { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0 }

/**
 * One OFF product → the shape the food log uses, per 100 g.
 *
 * Returns null for a product with no usable energy figure. A hit with a name and four zeroes
 * is worse than no hit: it looks like an answer, logs as nothing, and quietly under-reports
 * the day.
 */
export function parseProduct(p) {
  if (!p) return null
  const n = (p.product_name || p.generic_name || '').trim()
  if (!n) return null
  const nut = p.nutriments || {}
  // OFF exposes kcal directly on most products and kJ on some European ones.
  const kcal = num(nut['energy-kcal_100g']) || Math.round(num(nut['energy_100g']) / 4.184)
  const out = {
    n: n.slice(0, 80),
    brand: (p.brands || '').split(',')[0].trim().slice(0, 40),
    code: p.code || '',
    per: 100,
    kcal,
    p: num(nut.proteins_100g),
    c: num(nut.carbohydrates_100g),
    f: num(nut.fat_100g),
    // The serving the packet itself suggests, when it gives one — far more useful as a
    // default than 100 g for anything sold in portions.
    serving: num(p.serving_quantity),
  }
  return out.kcal > 0 ? out : null
}

/** Scale a per-100 g product to a real quantity, ready for the log. */
export function scaleProduct(prod, grams) {
  const g = num(grams) || prod.per || 100
  const k = g / (prod.per || 100)
  return {
    n: prod.brand ? `${prod.n} (${prod.brand})` : prod.n,
    q: `${Math.round(g)} g`,
    kcal: Math.round(prod.kcal * k),
    p: Math.round(prod.p * k * 10) / 10,
    c: Math.round(prod.c * k * 10) / 10,
    f: Math.round(prod.f * k * 10) / 10,
    src: 'db',
  }
}

// Only the fields we use, so a search is a few KB rather than a few hundred.
const FIELDS = 'code,product_name,generic_name,brands,nutriments,serving_quantity'

async function get(url, signal) {
  const r = await fetch(url, { signal, headers: { Accept: 'application/json', 'User-Agent': UA } })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

/** Search by name. Returns [] rather than throwing on an empty or unusable response. */
export async function searchFood(query, { signal, limit = 20 } = {}) {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
    `&search_simple=1&action=process&json=1&page_size=${limit}&fields=${FIELDS}`
  const data = await get(url, signal)
  return (data.products || []).map(parseProduct).filter(Boolean)
}

/** Look one product up by barcode. Returns null when the code is not in the database. */
export async function lookupBarcode(code, { signal } = {}) {
  const c = String(code || '').replace(/\D/g, '')
  if (c.length < 6) return null
  const data = await get(`${BASE}/api/v2/product/${c}?fields=${FIELDS}`, { signal })
  return data && data.status === 1 ? parseProduct(data.product) : null
}
