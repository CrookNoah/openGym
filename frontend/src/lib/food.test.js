import { describe, it, expect } from 'vitest'
import {
  normalizeEntry, kcalFromMacros, dayFood, totals, dayTotals, macroSplit,
  targetOf, remaining, suggestProtein, foodDays, kcalSeries, avgKcal,
  addFood, removeFood, updateFood, isEstimate, MACROS, PROTEIN_G_PER_KG,
} from './food.js'
import { parseProduct, scaleProduct } from './foodsearch.js'
import { parseResult, friendlyError } from './foodai.js'

const S = {
  unit: 'lb',
  bodyweight: [{ d: '2026-08-18', w: 176 }],
  food: [
    { id: 'a', d: '2026-08-19', t: 3, n: 'Eggs', q: '2', kcal: 140, p: 12, c: 1, f: 10, src: 'manual' },
    { id: 'b', d: '2026-08-19', t: 1, n: 'Oats', q: '80 g', kcal: 300, p: 10, c: 54, f: 6, src: 'db' },
    { id: 'c', d: '2026-08-18', t: 1, n: 'Chicken', q: '150 g', kcal: 248, p: 46, c: 0, f: 5, src: 'ai' },
  ],
}

describe('kcalFromMacros', () => {
  it('uses the Atwater factors', () => {
    expect(kcalFromMacros({ p: 10, c: 10, f: 10 })).toBe(4 * 10 + 4 * 10 + 9 * 10)
    expect(kcalFromMacros({})).toBe(0)
    expect(kcalFromMacros(null)).toBe(0)
  })
})

describe('normalizeEntry', () => {
  it('fills a missing calorie count from the macros rather than logging a zero', () => {
    const e = normalizeEntry({ n: 'Steak', p: 30, c: 0, f: 10 }, '2026-08-20')
    expect(e.kcal).toBe(210)
  })

  it('keeps a calorie count that came with the item, even when 4/4/9 disagrees', () => {
    // Labels round, and fibre and alcohol do not fit the three-macro model.
    const e = normalizeEntry({ n: 'Bar', kcal: 200, p: 10, c: 20, f: 5 }, '2026-08-20')
    expect(e.kcal).toBe(200)
  })

  it('refuses negative and nonsense numbers', () => {
    const e = normalizeEntry({ n: 'X', kcal: -5, p: 'abc', c: NaN, f: Infinity }, '2026-08-20')
    expect(e.kcal).toBe(0)
    MACROS.forEach(k => expect(e[k]).toBe(0))
  })

  it('always comes back with an id, a date and a name', () => {
    const e = normalizeEntry({}, '2026-08-20')
    expect(e.id).toBeTruthy()
    expect(e.d).toBe('2026-08-20')
    expect(e.n).toBe('Food')
  })

  it('falls back to a trustworthy source rather than an invented one', () => {
    expect(normalizeEntry({ n: 'X', kcal: 1, src: 'nonsense' }).src).toBe('manual')
    expect(normalizeEntry({ n: 'X', kcal: 1, src: 'ai' }).src).toBe('ai')
  })
})

describe('isEstimate', () => {
  it('marks only the AI entries, so a guess never reads as a measurement', () => {
    expect(isEstimate({ src: 'ai' })).toBe(true)
    expect(isEstimate({ src: 'db' })).toBe(false)
    expect(isEstimate({ src: 'manual' })).toBe(false)
    expect(isEstimate(null)).toBe(false)
  })
})

describe('dayFood and totals', () => {
  it('returns one day, oldest first', () => {
    const d = dayFood(S, '2026-08-19')
    expect(d.map(e => e.id)).toEqual(['b', 'a'])
  })

  it('adds a day up', () => {
    expect(dayTotals(S, '2026-08-19')).toEqual({ kcal: 440, p: 22, c: 55, f: 16 })
  })

  it('is zero for a day with nothing logged', () => {
    expect(dayTotals(S, '2020-01-01')).toEqual({ kcal: 0, p: 0, c: 0, f: 0 })
  })

  it('copes with an empty profile', () => {
    expect(totals(null)).toEqual({ kcal: 0, p: 0, c: 0, f: 0 })
    expect(dayFood({}, '2026-08-19')).toEqual([])
  })
})

describe('macroSplit', () => {
  it('splits by the energy the macros account for, and sums to 1', () => {
    const s = macroSplit({ p: 10, c: 10, f: 10 })
    expect(Math.round((s.p + s.c + s.f) * 1000) / 1000).toBe(1)
    expect(s.f).toBeGreaterThan(s.p)         // 9 kcal/g against 4
  })

  it('is all zeroes rather than NaN when nothing is logged', () => {
    expect(macroSplit({ p: 0, c: 0, f: 0 })).toEqual({ p: 0, c: 0, f: 0 })
    expect(macroSplit(null)).toEqual({ p: 0, c: 0, f: 0 })
  })
})

describe('targetOf and remaining', () => {
  it('has no opinion when nothing is set', () => {
    expect(targetOf(S)).toBe(null)
    expect(remaining(S, '2026-08-19')).toBe(null)
  })

  it('keeps every field independently optional', () => {
    expect(targetOf({ foodTarget: { kcal: 2000, p: 0, c: 0, f: 0 } })).toEqual({ kcal: 2000 })
    expect(targetOf({ foodTarget: { kcal: 0, p: 0, c: 0, f: 0 } })).toBe(null)
  })

  it('counts down only the fields that have a target', () => {
    const withT = { ...S, foodTarget: { kcal: 2000, p: 150 } }
    expect(remaining(withT, '2026-08-19')).toEqual({ kcal: 1560, p: 128 })
  })

  it('goes negative when the day went over', () => {
    const withT = { ...S, foodTarget: { kcal: 300 } }
    expect(remaining(withT, '2026-08-19').kcal).toBe(-140)
  })
})

describe('suggestProtein', () => {
  it('converts pounds before applying g/kg', () => {
    // 176 lb ≈ 79.8 kg × 1.6
    expect(suggestProtein(S)).toBe(Math.round((176 / 2.20462) * PROTEIN_G_PER_KG))
  })

  it('takes a kg profile at face value', () => {
    expect(suggestProtein({ unit: 'kg', bodyweight: [{ d: 'x', w: 80 }] })).toBe(128)
  })

  it('declines to guess with no weigh-in', () => {
    expect(suggestProtein({ unit: 'kg', bodyweight: [] })).toBe(null)
    expect(suggestProtein({})).toBe(null)
  })
})

describe('the charts', () => {
  it('lists logged days newest first', () => {
    expect(foodDays(S)).toEqual(['2026-08-19', '2026-08-18'])
  })

  it('leaves unlogged days out rather than drawing them as zero', () => {
    // A day you forgot to log is not a day you ate nothing.
    const pts = kcalSeries(S, 0)
    expect(pts.map(p => p.d)).toEqual(['2026-08-18', '2026-08-19'])
    expect(pts.map(p => p.y)).toEqual([248, 440])
  })

  it('averages over the days that were actually logged', () => {
    expect(avgKcal(S, 0)).toBe(Math.round((248 + 440) / 2))
    expect(avgKcal({ food: [] }, 0)).toBe(null)
  })
})

describe('mutations', () => {
  it('adds, edits and removes', () => {
    const s = { food: [] }
    const e = addFood(s, { n: 'Rice', kcal: 200, c: 44 }, '2026-08-20')
    expect(s.food).toHaveLength(1)
    updateFood(s, e.id, { kcal: 250 })
    expect(s.food[0].kcal).toBe(250)
    expect(s.food[0].n).toBe('Rice')          // untouched fields survive an edit
    removeFood(s, e.id)
    expect(s.food).toHaveLength(0)
  })

  it('starts the list for a profile that has never logged food', () => {
    const s = {}
    addFood(s, { n: 'X', kcal: 10 }, '2026-08-20')
    expect(s.food).toHaveLength(1)
  })

  it('ignores an edit or removal of something that is not there', () => {
    const s = { food: [] }
    expect(() => updateFood(s, 'nope', { kcal: 1 })).not.toThrow()
    expect(() => removeFood(s, 'nope')).not.toThrow()
  })
})

/* ---- the free database ---- */
describe('Open Food Facts parsing', () => {
  const product = {
    code: '123', product_name: 'Greek Yoghurt', brands: 'Acme, Other',
    nutriments: { 'energy-kcal_100g': 59, proteins_100g: 10, carbohydrates_100g: 3.6, fat_100g: 0.4 },
    serving_quantity: 170,
  }

  it('maps a product to the log shape', () => {
    const p = parseProduct(product)
    expect(p).toMatchObject({ n: 'Greek Yoghurt', brand: 'Acme', kcal: 59, p: 10, c: 3.6, f: 0.4, serving: 170 })
  })

  it('converts kJ when kcal is missing', () => {
    const p = parseProduct({ ...product, nutriments: { energy_100g: 418, proteins_100g: 1 } })
    expect(p.kcal).toBe(Math.round(418 / 4.184))
  })

  it('rejects a hit with no usable energy — worse than no hit at all', () => {
    expect(parseProduct({ ...product, nutriments: {} })).toBe(null)
    expect(parseProduct({ ...product, product_name: '' })).toBe(null)
    expect(parseProduct(null)).toBe(null)
  })

  it('scales per-100 g figures to the portion', () => {
    const s = scaleProduct(parseProduct(product), 170)
    expect(s.q).toBe('170 g')
    expect(s.kcal).toBe(Math.round(59 * 1.7))
    expect(s.p).toBe(17)
    expect(s.src).toBe('db')
    expect(s.n).toContain('Acme')
  })

  it('defaults to 100 g when no quantity is given', () => {
    expect(scaleProduct(parseProduct(product)).kcal).toBe(59)
  })
})

/* ---- the AI adapter, without a network ---- */
describe('AI result parsing', () => {
  it('normalises every item and marks the lot as an estimate', () => {
    const out = parseResult({ items: [{ n: 'Toast', q: '2 slices', kcal: 160, p: 6, c: 30, f: 2, confident: true }], note: '' })
    expect(out.items).toHaveLength(1)
    expect(out.items[0].src).toBe('ai')
    expect(isEstimate(out.items[0])).toBe(true)
  })

  it('carries the confidence flag through so an inferred portion can be shown as one', () => {
    const out = parseResult({ items: [{ n: 'Rice', q: '1 bowl', kcal: 200, p: 4, c: 44, f: 1, confident: false }], note: '' })
    expect(out.items[0].confident).toBe(false)
  })

  it('drops an item with nothing in it', () => {
    const out = parseResult({ items: [{ n: 'Water', q: '1 glass', kcal: 0, p: 0, c: 0, f: 0, confident: true }], note: 'no calories' })
    expect(out.items).toHaveLength(0)
    expect(out.note).toBe('no calories')
  })

  it('survives a malformed or empty response instead of throwing', () => {
    expect(parseResult(null)).toEqual({ items: [], note: '' })
    expect(parseResult({})).toEqual({ items: [], note: '' })
    expect(parseResult({ items: 'nope' }).items).toEqual([])
  })
})

describe('friendlyError', () => {
  it('says something a person can act on', () => {
    expect(friendlyError({ status: 401 })).toMatch(/key/i)
    expect(friendlyError({ status: 429 })).toMatch(/rate limit/i)
    expect(friendlyError({ status: 500 })).toMatch(/try again/i)
    expect(friendlyError({ message: 'Failed to fetch' })).toMatch(/connection/i)
    expect(typeof friendlyError({})).toBe('string')
  })
})
