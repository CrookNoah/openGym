// Starter plans. Shared by the "Load starter plan" action in Settings, the welcome card on
// Home, and — for the barbell one only — the demo build, which seeds a history on top of
// exactly those routines.
//
// The original app shipped one plan, built on a barbell, a leg press and three lever
// machines. That is the right plan if you have a gym and the wrong one if you have a floor,
// and it was the first thing a new profile was offered. So plans now come as a list, each
// declaring the kit it needs (lib/gear.js), and the chooser only offers what you can train.
import { uid } from './format.js'

// [id, sets, reps, repsMax] — repsMax is the top of the range, after which the bodyweight
// policy adds a set instead of a rep, and eventually offers the next rung of the ladder.
// [id, sets, 'sec', seconds, secMax] for a hold.
const reps = (id, sets, r, max) => ({ id, sets, reps: r, weight: 0, mode: 'reps', ...(max ? { repsMax: max } : {}) })
const side = (id, sets, r, max) => ({ ...reps(id, sets, r, max), side: true })
const hold = (id, sets, sec, max) => ({ id, sets, sec, weight: 0, mode: 'time', prog: 'time', ...(max ? { secMax: max } : {}) })
// Loaded work keeps the shape it always had, so the barbell plan below is byte-for-byte
// what the demo seed and every existing plan file expect.
const load = (id, sets, r) => ({ id, sets, reps: r, weight: 0 })

const PPL_SPEC = [
  ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

/**
 * Fresh routine objects (new ids) for the barbell Push/Pull/Legs plan — [push, pull, legs].
 *
 * Kept exactly as it was, and kept exported under its old name: lib/demoSeed.js fabricates
 * twelve weeks of history against these specific exercise ids, so changing the shape here
 * would quietly break the demo build rather than fail anywhere visible.
 */
export const starterRoutines = () =>
  PPL_SPEC.map(([name, emoji, list]) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, r]) => load(id, sets, r)) }))

/* ---------------------------------------------------------------------------------------
   The plans.

   `gear` is what a plan needs beyond a floor, so the chooser can hide a plan you cannot
   train instead of letting you load it and discover the problem one exercise at a time.
   `week` maps weekday (getDay(), 0 = Sunday) to an index into `routines`.

   Every bodyweight entry carries a rep ceiling. Without one the engine adds a rep a session
   forever; with one it fills the range, adds a set, and then — at the top — offers the next
   variation on the ladder, which is how bodyweight training actually goes up.
--------------------------------------------------------------------------------------- */
export const STARTER_PLANS = [
  {
    key: 'bw-basics',
    name: 'Bodyweight basics',
    sub: 'Three full-body sessions a week. Nothing but a floor.',
    note: 'Every movement starts on an easy rung so the first week is finishable. When a lift tops out its rep range, openGym offers you the next variation up.',
    gear: [],
    days: 'Mon · Wed · Fri',
    week: { 1: 0, 3: 0, 5: 0 },
    routines: [
      { name: 'Full Body', emoji: 'figureStrength', ex: [
        reps('3211', 3, 8, 15),    // kneeling push-up
        reps('3166', 3, 10, 20),   // bodyweight standing row
        reps('3132', 3, 10, 20),   // potty squat with support
        reps('3013', 3, 12, 25),   // low glute bridge on floor
        hold('3239', 3, 30, 60),   // kneeling plank, shoulder taps
        reps('0872', 3, 10, 20),   // reverse crunch
      ] },
    ],
  },
  {
    key: 'bw-ppl',
    name: 'Push / Pull / Legs — bodyweight',
    sub: 'The classic split with no equipment at all.',
    note: 'Pulling without a bar leans on self-resistance and towel rows, which work but cap out sooner than the rest. A pull-up bar is the one purchase that changes this plan the most — add it in Settings and the pulling ladders grow.',
    gear: [],
    days: 'Mon · Wed · Fri',
    week: { 1: 0, 3: 1, 5: 2 },
    routines: [
      { name: 'Push', emoji: 'figureStrength', ex: [
        reps('0662', 4, 10, 20),   // push-up
        reps('0279', 3, 8, 15),    // decline push-up
        reps('0815', 3, 10, 20),   // triceps dips floor
        reps('0259', 3, 8, 15),    // close-grip push-up
        hold('3665', 3, 45, 90),   // power point plank
      ] },
      { name: 'Pull', emoji: 'pullup', ex: [
        reps('3165', 4, 12, 20),   // standing row (with towel)
        side('3162', 3, 16, 24),   // standing one arm row
        reps('3158', 3, 12, 20),   // standing close-grip row
        reps('3168', 3, 12, 20),   // squatting row
        reps('0865', 3, 10, 20),   // lying leg-hip raise
      ] },
      { name: 'Legs', emoji: 'legs', ex: [
        reps('3119', 4, 15, 25),   // potty squat
        side('3470', 3, 16, 24),   // forward lunge
        reps('3013', 3, 15, 25),   // low glute bridge on floor
        reps('1373', 3, 20, 30),   // standing calf raise
        reps('0689', 3, 12, 20),   // seated leg raise
      ] },
    ],
  },
  {
    key: 'gym-ppl',
    name: 'Push / Pull / Legs — barbell',
    sub: 'The original openGym starter plan. Needs a gym.',
    note: 'Barbell, dumbbells, cables and machines.',
    gear: ['gym'],
    days: 'Mon · Wed · Fri',
    week: { 1: 0, 3: 1, 5: 2 },
    routines: PPL_SPEC.map(([name, emoji, list]) => ({ name, emoji, ex: list.map(([id, sets, r]) => load(id, sets, r)) })),
  },
]

export const planByKey = key => STARTER_PLANS.find(p => p.key === key) || null

/** Fresh routines for one plan, plus the weekday → routine-id map that goes with them. */
export function buildPlan(plan) {
  const routines = plan.routines.map(r => ({ id: uid(), name: r.name, emoji: r.emoji, ex: r.ex.map(e => ({ ...e })) }))
  const week = {}
  Object.entries(plan.week).forEach(([d, i]) => { if (routines[i]) week[d] = routines[i].id })
  return { routines, week }
}
