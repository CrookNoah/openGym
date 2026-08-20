// What you actually own, and therefore what the app is allowed to suggest.
//
// The exercise dataset has one `eq` field per exercise, and for calisthenics it is not
// enough: a push-up and a one-arm chin-up are both "body weight", but one needs a floor
// and the other needs something to hang from. Training at home is decided by the second
// distinction, not the first — so this maps every exercise onto the *kit* it needs.
//
// `S.gear` is the list of keys you have. It is null on a profile that has never chosen,
// and null means "no filtering at all" — the app has to keep behaving exactly as it did
// for someone who never opens the picker, rather than quietly hiding two thirds of the
// catalogue on them.

// Floor is not in the list because it is not a choice: everybody has a floor, and an
// exercise needing nothing else is always available.
//
// Loaded kit is split rather than being one "gym" box, because the difference decides real
// plans: a pair of dumbbells at home is not a cable stack, and an app that offers the leg
// press to someone who ticked "weights" because they own two 10 kg dumbbells has not asked
// the right question.
export const GEAR = [
  { key: 'bar', name: 'Pull-up bar', hint: 'Doorway bar, wall bar, or a beam you can hang from.' },
  { key: 'dip', name: 'Dip bars or parallettes', hint: 'Parallel bars, parallettes, or two sturdy surfaces at hip height.' },
  { key: 'rings', name: 'Rings or a suspension trainer', hint: 'Gymnastic rings, TRX-style straps.' },
  { key: 'bench', name: 'Bench, box or chair', hint: 'Anything solid at knee height — a chair, a step, a stair.' },
  { key: 'bands', name: 'Resistance bands', hint: 'Loop or handle bands, for assistance or added resistance.' },
  { key: 'vest', name: 'Dip belt or weight vest', hint: 'Load for bodyweight movements once reps stop being the limit.' },
  { key: 'dumbbell', name: 'Dumbbells', hint: 'A pair, or an adjustable set.' },
  { key: 'kettlebell', name: 'Kettlebells', hint: 'One is enough for swings and goblet work.' },
  { key: 'barbell', name: 'Barbell & plates', hint: 'A bar you can load — rack optional but useful.' },
  { key: 'machines', name: 'Machines & cables', hint: 'A commercial gym: cable stacks, leverage machines, sleds.' },
]
export const GEAR_KEYS = GEAR.map(g => g.key)
export const GEAR_NAME = Object.fromEntries(GEAR.map(g => [g.key, g.name]))
// The one everybody has. Never stored, never offered, always satisfied.
export const FLOOR = 'floor'
// Profiles saved before the split carry a single 'gym' key. It granted all loaded kit, so it
// keeps meaning exactly that — expanded on read, migrated to the new keys on the next save.
export const LEGACY_GYM = 'gym'
export const GYM_FAMILY = ['vest', 'dumbbell', 'kettlebell', 'barbell', 'machines']

// Dataset `eq` values that are not bodyweight at all. Anything absent from this map and not
// "body weight" falls through to 'machines' — the safe answer for kit we don't model, since
// it hides the exercise from someone training at home and shows it to someone in a gym.
const EQ_GEAR = {
  'body weight': null,          // decided by name — see BW_GEAR
  band: 'bands',
  'resistance band': 'bands',
  dumbbell: 'dumbbell',
  kettlebell: 'kettlebell',
  barbell: 'barbell',
  'ez barbell': 'barbell',
  'olympic barbell': 'barbell',
  'trap bar': 'barbell',
  weighted: 'vest',             // a dip belt or vest — the load on top of a bodyweight movement
  // Everything below lives in a commercial gym or is close enough to one: cables, leverage
  // machines, sleds, ergometers, and the loose kit (balls, rollers, ropes) a gym floor has
  // and a living room usually does not.
  cable: 'machines',
  'leverage machine': 'machines',
  'smith machine': 'machines',
  'sled machine': 'machines',
  assisted: 'machines',
  'stability ball': 'machines',
  'medicine ball': 'machines',
  'bosu ball': 'machines',
  roller: 'machines',
  'wheel roller': 'machines',
}

// Exercises whose name gives the kit away only if you already know the movement. An
// "inverted row" needs a bar low enough to lie under, and says so nowhere in its name —
// left to the patterns below it reads as floor work and gets recommended to someone with
// nothing to hang from. Names are cheaper to get wrong than ids, so these are pinned.
const BW_ID_GEAR = {
  '0499': 'bar',   // inverted row
  '0497': 'bar',   // inverted row v. 2
  '2300': 'bar',   // inverted row bent knees
  '2298': 'bench', // inverted row on bench
  '3193': 'bench', // glute-ham raise — something has to hold your feet down
  '0284': 'bench', // donkey calf raise
  '1386': 'bench', // one leg donkey calf raise
}

// Bodyweight exercises, split by what they hang from / press against. Order matters: the
// first pattern that matches wins, so each exclusion sits above the rule it carves out of.
const BW_GEAR = [
  // "Dips" spans three different setups. Floor dips need a floor, a bench dip needs a bench,
  // and a chest dip needs bars — so the two easier ones are lifted out before the bars rule.
  [/(dip on floor|dips floor|elbow dips|scapula dips)/, FLOOR],
  [/bench dip/, 'bench'],
  [/\b(ring|suspend|strap)/, 'rings'],
  [/(pull.?up|chin.?up|hanging|hang\b|muscle.?up|front lever|back lever|arm slingers|scapular pull)/, 'bar'],
  [/\bdips?\b|parallel bars|parallette/, 'dip'],
  // An incline push-up is done against any raised surface and stays floor work; an incline
  // sit-up needs an actual bench to hook your feet under.
  [/(incline|decline).*(sit.?up|crunch|leg raise|hip raise|leg-hip)/, 'bench'],
  [/\b(bench|box|chair|staircase|stairs|on a step|captains chair)\b/, 'bench'],
]

/** The single piece of kit an exercise needs, or FLOOR when it needs none. */
export function gearOf(ex) {
  if (!ex) return FLOOR
  // A custom exercise is something you invented and can evidently do — never filtered away.
  if (ex.custom) return FLOOR
  const eq = String(ex.eq || '').toLowerCase()
  if (eq !== 'body weight') {
    if (eq in EQ_GEAR) return EQ_GEAR[eq] || FLOOR
    return 'machines'   // ergometers, tires, hammers — gym-floor kit we don't model separately
  }
  if (BW_ID_GEAR[ex.id]) return BW_ID_GEAR[ex.id]
  const n = String(ex.n || '').toLowerCase()
  for (const [re, key] of BW_GEAR) if (re.test(n)) return key
  return FLOOR
}

/** Has this profile chosen a kit list at all? Null means "show me everything", as before. */
export const gearChosen = S => Array.isArray(S && S.gear)

/** Do you have this piece of kit? The floor is free, and an unset profile has everything. */
export function hasGear(S, key) {
  if (!key || key === FLOOR) return true
  if (!gearChosen(S)) return true
  if (S.gear.includes(key)) return true
  // A pre-split profile that ticked "Weights and machines" owns the whole loaded family.
  return GYM_FAMILY.includes(key) && S.gear.includes(LEGACY_GYM)
}

/** The stored list with any legacy 'gym' expanded — what the picker should show as ticked. */
export const expandGear = list =>
  (list || []).includes(LEGACY_GYM)
    ? [...new Set([...(list || []).filter(k => k !== LEGACY_GYM), ...GYM_FAMILY])]
    : [...(list || [])]

/** Can this profile train this exercise with what it owns? */
export const canDo = (S, ex) => hasGear(S, gearOf(ex))

/** Narrow a list of exercises to what the kit allows. A no-op on an unset profile. */
export const filterByGear = (S, list) => (gearChosen(S) ? list.filter(ex => canDo(S, ex)) : list)

// A short human summary for the settings row: "Floor only", "Floor · Pull-up bar", …
export function gearSummary(S, tr) {
  const x = tr || (s => s)
  if (!gearChosen(S)) return x('Everything in the library')
  const have = expandGear(S.gear)
  const owned = GEAR.filter(g => have.includes(g.key))
  if (!owned.length) return x('Floor only')
  return x('Floor') + ' · ' + owned.map(g => x(g.name)).join(' · ')
}
