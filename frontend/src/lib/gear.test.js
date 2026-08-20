import { describe, it, expect } from 'vitest'
import { gearOf, hasGear, canDo, filterByGear, gearChosen, gearSummary, expandGear, GEAR, GEAR_KEYS, FLOOR } from './gear.js'
import { EXDB, EXIDX } from './exercises.js'

const ex = id => EXIDX[id]
const FLOOR_ONLY = { gear: [] }
const WITH_BAR = { gear: ['bar'] }
const UNSET = {}

describe('gearOf', () => {
  it('puts a push-up on the floor and a pull-up on a bar', () => {
    expect(gearOf(ex('0662'))).toBe(FLOOR)      // push-up
    expect(gearOf(ex('0652'))).toBe('bar')      // pull-up
    expect(gearOf(ex('1326'))).toBe('bar')      // chin-up
  })

  it('separates a bench dip from a bar dip — same word, different kit', () => {
    expect(gearOf(ex('0815'))).toBe(FLOOR)      // triceps dips floor
    expect(gearOf(ex('1399'))).toBe(FLOOR)      // bench dip on floor
    expect(gearOf(ex('3287'))).toBe(FLOOR)      // elbow dips
    expect(gearOf(ex('0251'))).toBe('dip')      // chest dip
    expect(gearOf(ex('3288'))).toBe('dip')      // korean dips
  })

  it('reads hanging work as needing something to hang from', () => {
    expect(gearOf(ex('0472'))).toBe('bar')      // hanging leg raise
    expect(gearOf(ex('3296'))).toBe('bar')      // front lever
  })

  it('sends rings and suspension work to rings', () => {
    expect(gearOf(ex('0677'))).toBe('rings')    // ring dips
    expect(gearOf(ex('0808'))).toBe('rings')    // suspended row
  })

  it('tells loaded kit apart instead of lumping it into one gym bucket', () => {
    expect(gearOf(ex('0025'))).toBe('barbell')     // barbell bench press
    expect(gearOf(ex('0426'))).toBe('dumbbell')    // dumbbell overhead press
    expect(gearOf(ex('0549'))).toBe('kettlebell')  // kettlebell swing
    expect(gearOf(ex('0739'))).toBe('machines')    // sled leg press
    expect(gearOf(ex('0585'))).toBe('machines')    // lever leg extension
    expect(gearOf(ex('2330'))).toBe('machines')    // cable lat pulldown
  })

  it('reads a dip belt as the load it is, not as a gym', () => {
    expect(gearOf(ex('2135'))).toBe('vest')        // weighted front plank
  })

  it('keeps a pre-split gym profile owning the whole loaded family', () => {
    const legacy = { gear: ['gym'] }
    expect(hasGear(legacy, 'dumbbell')).toBe(true)
    expect(hasGear(legacy, 'barbell')).toBe(true)
    expect(hasGear(legacy, 'machines')).toBe(true)
    expect(hasGear(legacy, 'bar')).toBe(false)     // gym never implied a home pull-up bar
    expect(expandGear(['gym', 'bar']).sort()).toEqual(['bar', 'barbell', 'dumbbell', 'kettlebell', 'machines', 'vest'])
    expect(expandGear(['bar'])).toEqual(['bar'])
  })

  it('reads bands as bands', () => {
    expect(gearOf(ex('0970'))).toBe('bands')    // band assisted pull-up
  })

  it('never filters away an exercise you invented yourself', () => {
    expect(gearOf({ id: 'c1', n: 'ring muscle-up on a barbell', eq: 'custom', custom: true })).toBe(FLOOR)
  })

  it('answers for a missing exercise instead of throwing', () => {
    expect(gearOf(null)).toBe(FLOOR)
    expect(gearOf(undefined)).toBe(FLOOR)
  })

  it('only ever returns a key the picker actually offers', () => {
    const allowed = new Set([FLOOR, ...GEAR_KEYS])
    EXDB.forEach(e => expect(allowed.has(gearOf(e))).toBe(true))
  })
})

describe('hasGear', () => {
  it('gives everyone a floor', () => {
    expect(hasGear(FLOOR_ONLY, FLOOR)).toBe(true)
    expect(hasGear(FLOOR_ONLY, null)).toBe(true)
  })

  it('gives a profile that never chose the whole library', () => {
    expect(hasGear(UNSET, 'machines')).toBe(true)
    expect(hasGear(UNSET, 'bar')).toBe(true)
    expect(gearChosen(UNSET)).toBe(false)
  })

  it('holds a floor-only profile to the floor', () => {
    expect(hasGear(FLOOR_ONLY, 'bar')).toBe(false)
    expect(hasGear(FLOOR_ONLY, 'barbell')).toBe(false)
    expect(gearChosen(FLOOR_ONLY)).toBe(true)
  })

  it('unlocks exactly what was ticked', () => {
    expect(hasGear(WITH_BAR, 'bar')).toBe(true)
    expect(hasGear(WITH_BAR, 'dip')).toBe(false)
  })
})

describe('filterByGear', () => {
  it('leaves an unset profile completely alone', () => {
    expect(filterByGear(UNSET, EXDB).length).toBe(EXDB.length)
  })

  it('cuts a floor-only profile down to what it can train', () => {
    const out = filterByGear(FLOOR_ONLY, EXDB)
    expect(out.length).toBeGreaterThan(100)
    expect(out.length).toBeLessThan(EXDB.length)
    expect(out.every(e => canDo(FLOOR_ONLY, e))).toBe(true)
    expect(out.some(e => e.id === '0662')).toBe(true)   // push-up survives
    expect(out.some(e => e.id === '0652')).toBe(false)  // pull-up does not
    expect(out.some(e => e.id === '0025')).toBe(false)  // nor the bench press
  })

  it('grows the catalogue when you buy a bar rather than replacing it', () => {
    const floor = filterByGear(FLOOR_ONLY, EXDB).map(e => e.id)
    const bar = filterByGear(WITH_BAR, EXDB).map(e => e.id)
    expect(bar.length).toBeGreaterThan(floor.length)
    floor.forEach(id => expect(bar).toContain(id))
    expect(bar).toContain('0652')
  })
})

describe('gearSummary', () => {
  it('names the state in words the settings row can show', () => {
    expect(gearSummary(UNSET)).toMatch(/Everything/)
    expect(gearSummary(FLOOR_ONLY)).toBe('Floor only')
    expect(gearSummary(WITH_BAR)).toContain(GEAR.find(g => g.key === 'bar').name)
  })
})
