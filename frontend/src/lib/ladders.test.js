import { describe, it, expect } from 'vitest'
import {
  LADDERS, HELD_RUNGS, ladderOf, ladderPositions, isOnLadder,
  nextRung, prevRung, ladderPos, rungsFor, rungName, isHeldRung
} from './ladders.js'
import { EXIDX } from './exercises.js'
import { gearOf } from './gear.js'

const FLOOR_ONLY = { gear: [] }
const WITH_BAR = { gear: ['bar'] }
const EVERYTHING = {}   // never chose — has the run of the library

describe('the ladders themselves', () => {
  // The whole feature is a table of hand-written ids. A typo would not throw anywhere: it
  // would quietly become a rung nobody can ever reach, or an "Unknown exercise" offered as
  // the next step. This is the test that has to exist.
  it('is built entirely from ids that resolve in the exercise library', () => {
    LADDERS.forEach(l => l.rungs.forEach(id => {
      expect(EXIDX[id], `${l.key}: unknown exercise id ${id}`).toBeTruthy()
    }))
  })

  it('never lists the same exercise twice on one ladder', () => {
    LADDERS.forEach(l => expect(new Set(l.rungs).size, l.key).toBe(l.rungs.length))
  })

  it('gives every ladder somewhere to climb', () => {
    LADDERS.forEach(l => expect(l.rungs.length, l.key).toBeGreaterThan(2))
  })

  // Someone training on a floor has to have somewhere to start in every pattern that can be
  // trained on a floor — otherwise the ladders are a feature only a gym gets to use.
  it('gives a floor-only profile a way into every pattern that has one', () => {
    const FLOOR_PATTERNS = ['push', 'vpush', 'dip', 'row', 'squat', 'hinge', 'core', 'legraise', 'calf']
    FLOOR_PATTERNS.forEach(key => {
      expect(rungsFor(FLOOR_ONLY, key).length, `${key} has no floor rung`).toBeGreaterThan(1)
    })
  })

  // Vertical pulling is the one pattern the floor genuinely cannot give you: every rung
  // needs something to hang from. Asserted rather than worked around, because it is the
  // honest answer and the reason the app tells you a bar is the purchase that matters most.
  it('needs a bar for the whole pull-up ladder', () => {
    expect(rungsFor(FLOOR_ONLY, 'pull')).toEqual([])
    expect(rungsFor(WITH_BAR, 'pull').length).toBeGreaterThan(3)
  })

  it('reaches every rung for a profile that owns everything', () => {
    LADDERS.forEach(l => {
      expect(rungsFor(EVERYTHING, l.key).length, l.key).toBe(l.rungs.length)
      l.rungs.forEach(id => expect(gearOf(EXIDX[id]), `${l.key}/${id}`).toBeTruthy())
    })
  })

  it('only marks real exercises as held positions', () => {
    HELD_RUNGS.forEach(id => expect(EXIDX[id], `held rung ${id}`).toBeTruthy())
  })
})

describe('ladderOf', () => {
  it('finds the ladder an exercise sits on', () => {
    expect(ladderOf('0662').ladder.key).toBe('push')     // push-up
    expect(ladderOf('0652').ladder.key).toBe('pull')     // pull-up
    expect(isOnLadder('0662')).toBe(true)
  })

  it('returns nothing for an exercise that is not on one', () => {
    expect(ladderOf('0025')).toBe(null)                  // barbell bench press
    expect(isOnLadder('0025')).toBe(false)
  })

  it('picks the ladder with the most room left when an exercise sits on two', () => {
    // A decline push-up is both a hard horizontal press and the easiest overhead one. Four
    // rungs remain above it on the push ladder and three on the overhead one, so the push
    // ladder wins — whichever leaves more room to grow.
    expect(ladderPositions('0279').length).toBe(2)
    expect(ladderOf('0279').ladder.key).toBe('push')
  })
})

describe('nextRung', () => {
  it('offers the next variation up', () => {
    expect(nextRung(EVERYTHING, '3211')).toBe('0662')    // kneeling push-up → push-up
    expect(nextRung(EVERYTHING, '0662')).toBe('0259')    // push-up → close-grip
  })

  it('steps over rungs you have no kit for', () => {
    // An inverted row needs a bar low enough to lie under, so a floor-only profile tops out
    // one rung earlier instead of being sent to kit it does not have.
    expect(nextRung(FLOOR_ONLY, '3162')).toBe('3156')    // still floor work
    expect(nextRung(FLOOR_ONLY, '3156')).toBe(null)      // top of the reachable row ladder
    expect(nextRung(WITH_BAR, '3156')).toBe('0499')      // the bar opens the next rung
  })

  it('returns nothing at the top of a ladder', () => {
    expect(nextRung(EVERYTHING, '3327')).toBe(null)      // full planche push-up
  })

  it('returns nothing for an exercise with no ladder', () => {
    expect(nextRung(EVERYTHING, '0025')).toBe(null)
  })
})

describe('prevRung', () => {
  it('offers an easier variation to drop back to', () => {
    expect(prevRung(EVERYTHING, '0662')).toBe('3211')    // push-up → kneeling push-up
  })

  it('returns nothing at the bottom', () => {
    expect(prevRung(EVERYTHING, '0659')).toBe(null)      // wall push-up
  })
})

describe('ladderPos', () => {
  it('counts only the rungs this profile can actually train', () => {
    const all = ladderPos(EVERYTHING, '0662')
    const floor = ladderPos(FLOOR_ONLY, '0662')
    expect(all.name).toBe('Push-up')
    // The push ladder is entirely floor work, so both counts agree here…
    expect(floor.total).toBe(all.total)
    // …while a pulling ladder shrinks hard without a bar.
    expect(ladderPos(FLOOR_ONLY, '3166').total).toBeLessThan(ladderPos(WITH_BAR, '3166').total)
  })

  it('knows when you are at the top of what you can reach', () => {
    expect(ladderPos(FLOOR_ONLY, '3156').atTop).toBe(true)
    expect(ladderPos(WITH_BAR, '3156').atTop).toBe(false)
  })

  it('returns nothing for an exercise off the ladders', () => {
    expect(ladderPos(EVERYTHING, '0025')).toBe(null)
  })
})

describe('rungsFor', () => {
  it('lists a ladder narrowed to your kit, easiest first', () => {
    const floor = rungsFor(FLOOR_ONLY, 'pull')
    const bar = rungsFor(WITH_BAR, 'pull')
    expect(bar.length).toBeGreaterThan(floor.length)
    expect(bar).toContain('0652')
    expect(floor).not.toContain('0652')
  })

  it('is empty for a ladder that does not exist', () => {
    expect(rungsFor(EVERYTHING, 'nope')).toEqual([])
  })
})

describe('rung helpers', () => {
  it('names a rung', () => {
    expect(rungName('0662')).toBe('push-up')
  })

  it('renders an unknown id as a placeholder rather than throwing', () => {
    expect(typeof rungName('zzzz')).toBe('string')
  })

  it('knows which rungs are held rather than repped', () => {
    expect(isHeldRung('3419')).toBe(true)     // l-sit on floor
    expect(isHeldRung('0662')).toBe(false)    // push-up
  })
})
