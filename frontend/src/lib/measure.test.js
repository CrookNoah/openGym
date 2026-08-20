import { describe, it, expect } from 'vitest'
import {
  SITES, SITE_NAME, lenUnit, validMeasure, addMeasures, removeMeasure,
  siteSeries, lastOf, siteDelta, measuredSites,
} from './measure.js'

describe('the sites', () => {
  it('names every site it offers', () => {
    SITES.forEach(k => expect(typeof SITE_NAME[k], k).toBe('string'))
  })
})

describe('lenUnit', () => {
  it('rides on the weight unit the profile already chose', () => {
    expect(lenUnit({ unit: 'lb' })).toBe('in')
    expect(lenUnit({ unit: 'kg' })).toBe('cm')
    expect(lenUnit({})).toBe('cm')
    expect(lenUnit(null)).toBe('cm')
  })
})

describe('validMeasure', () => {
  it('accepts a girth and rejects a typo', () => {
    expect(validMeasure(82.5, 'cm')).toBe(true)
    expect(validMeasure('82.5', 'cm')).toBe(true)
    expect(validMeasure(0, 'cm')).toBe(false)
    expect(validMeasure(-3, 'cm')).toBe(false)
    expect(validMeasure('waist', 'cm')).toBe(false)
    expect(validMeasure(825, 'cm')).toBe(false)     // fat-fingered decimal
    expect(validMeasure(825, 'in')).toBe(false)
    expect(validMeasure(32, 'in')).toBe(true)
  })
})

describe('addMeasures', () => {
  it('writes one entry per filled site and skips the rest', () => {
    const s = { unit: 'kg' }
    const n = addMeasures(s, { waist: 82, chest: '101.3', biceps: '' }, '2026-08-20')
    expect(n).toBe(2)
    expect(s.measurements.length).toBe(2)
    const waist = s.measurements.find(m => m.k === 'waist')
    expect(waist.v).toBe(82)
    expect(waist.d).toBe('2026-08-20')
    expect(waist.id).toBeTruthy()
    expect(s.measurements.find(m => m.k === 'chest').v).toBe(101.3)
    expect(s.measurements.find(m => m.k === 'biceps')).toBeUndefined()
  })

  it('corrects a same-day reading instead of stacking a duplicate', () => {
    const s = { unit: 'kg' }
    addMeasures(s, { waist: 82 }, '2026-08-20')
    addMeasures(s, { waist: 81.5 }, '2026-08-20')
    expect(s.measurements.length).toBe(1)
    expect(s.measurements[0].v).toBe(81.5)
  })

  it('ignores sites it does not know and values that cannot be real', () => {
    const s = { unit: 'kg' }
    expect(addMeasures(s, { earlobe: 4, waist: -2, chest: 9999 }, '2026-08-20')).toBe(0)
    expect(s.measurements).toEqual([])
  })
})

describe('reading the log back', () => {
  const s = { unit: 'kg' }
  addMeasures(s, { waist: 84, biceps: 34 }, '2026-07-01')
  addMeasures(s, { waist: 83 }, '2026-07-15')
  addMeasures(s, { waist: 82 }, '2026-08-01')

  it('serves a site oldest first', () => {
    const pts = siteSeries(s, 'waist')
    expect(pts.map(p => p.y)).toEqual([84, 83, 82])
    expect(pts[0].d).toBe('2026-07-01')
  })

  it('knows the latest reading and how it moved', () => {
    expect(lastOf(s, 'waist').y).toBe(82)
    expect(siteDelta(s, 'waist')).toBe(-1)
    expect(lastOf(s, 'biceps').y).toBe(34)
    expect(siteDelta(s, 'biceps')).toBe(null)   // one reading is not a trend
    expect(lastOf(s, 'calf')).toBe(null)
  })

  it('lists the measured sites in body order', () => {
    expect(measuredSites(s)).toEqual(['waist', 'biceps'])
    expect(measuredSites({})).toEqual([])
    expect(measuredSites(null)).toEqual([])
  })

  it('removes an entry by id', () => {
    const s2 = { unit: 'kg' }
    addMeasures(s2, { waist: 84 }, '2026-07-01')
    removeMeasure(s2, s2.measurements[0].id)
    expect(s2.measurements).toEqual([])
  })
})
