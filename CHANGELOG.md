# Changelog

## v2.1.0 — 2026-08-21 — the week made visible

v2.0 built the engines; this release points them at the screens where the questions actually
get asked. "What is being hit?" now has an answer before training (Home), while planning
(Plan), mid-slump (the workout screen) and in ambition (the ladder, laid out end to end).

### What is being hit, answered everywhere

- 🏷️ **The today card names its muscles.** Home shows what today's session trains, as chips,
  without opening anything.
- ✅ **A live Week check on the Plan tab.** The wizard's coverage audit — a body map of the
  week, what is missed, what is light, what the kit cannot reach — now runs permanently on
  the plan as it stands, recomputed as you edit. A hand-edited plan is held to the same
  kit-scaled, week-scaled bar as a generated one, and a test asserts the two measures can
  never quietly diverge.
- ⚠️ **Back-to-back warnings.** Drag two sessions that hammer the same muscles onto
  consecutive days and the Week check says so, and why it matters.

### The ladder, laid out

- 🪜 **Tap any ladder in Stats to see the whole road** — every rung with its demo, easiest
  first, your current step marked, unreachable rungs dimmed and named with the kit that
  unlocks them. "A one-arm push-up is four steps away" is now something the app can show you.

### Bad days and warm-ups

- ⬇️ **"Too hard today?"** on any ladder exercise mid-workout swaps in the easier variation
  for this session only — plan and history untouched, next time opens on the planned rung.
  The engine's own drop-back (after repeated stalls) still rewrites the routine; this never
  does.
- 🔥 **Warm-up sets, properly excluded.** A per-exercise toggle adds one half-effort set
  marked W — half the weight on a loaded lift, half the reps on bodyweight, half the hold on
  a timed one. It is invisible to progression end to end: judging, next-session seeding, the
  prescribed-set count and the effort statistics all count working sets only, and imported
  histories (Strong/Hevy) now carry their warm-up rows under the same flag instead of reading
  as missed sessions.
- All of it in all twelve languages, same as everything else.

## v2.0.0 — 2026-08-20 — training with no equipment

This fork is aimed at training at home with nothing but a floor. openGym already logged
bodyweight work properly (v1.2.4); what it could not do was *plan* it, *progress* it or
*measure* it. Three things were missing, and they turn out to be the same gap seen from
three sides: the app assumed progress meant a heavier bar.

### Progress by variation, not by load

- 🪜 **Variation ladders.** Ten movement patterns — push, overhead push, dip, row, pull-up,
  squat, hip hinge, core hold, leg raise, calf — each a chain of real catalogue exercises
  ordered easiest to hardest, from a wall push-up to a full planche push-up. v1.2.4 ended
  a maxed-out push-up with "time to add weight or move to a harder variation" and stopped
  there, which is correct and useless without a dip belt. The same moment now names the
  variation, shows you its animation and instructions, and switches your routine to it if
  you say yes. It only ever offers — nothing is swapped behind your back.
- **The new rung starts easy on purpose.** A level-up drops back to a third of the reps you
  maxed out at and to the normal set count, because the extra sets existed precisely because
  the old variation had got easy. A new variation you cannot finish is one you stop doing.
- ⬇️ **Stalls go down the ladder.** Bodyweight work that keeps missing its target has no load
  to strip, so the honest deload is an easier position — and openGym now names that too,
  instead of holding the same target forever.
- ⏱️ **Holds have a ceiling as well.** A four-minute plank is a way to be bored. Set a top of
  the range on a timed hold and it becomes an L-sit rather than a longer plank.

### The app knows what you own

- 🔧 **"What have you got?"** — a kit list: pull-up bar, dip bars, rings, a bench, bands,
  weights. The library, the exercise picker, the starter plans and the ladders are all
  filtered to it. A profile that never chooses keeps the whole catalogue, exactly as before.
- The classifier reads the *movement*, not just the equipment field: a push-up and a one-arm
  chin-up are both "body weight", but one needs a floor and the other needs something to hang
  from. Bench dips, floor dips and bar dips are three different setups sharing one word.
- **Buying a bar grows the ladders** rather than replacing them: your history stays underneath
  and new rungs appear above the ones you have been training.

### Plans you can actually do

- 🧍 **Two floor-only starter plans** — a three-day full-body plan for getting going, and a
  bodyweight Push/Pull/Legs split. Every exercise ships with a rep or hold ceiling, so the
  ladder actually fires. The barbell Push/Pull/Legs plan is still there, marked as needing a
  gym; the starter action is now a chooser instead of dropping a leg press on you unasked.
- The bodyweight plan says out loud that pulling without a bar caps out sooner than the rest,
  because it does — vertical pulling is the one pattern a floor genuinely cannot give you.

### Programming, audited rather than asserted

The first cut of the floor-only plans was a bodyweight Push/Pull/Legs, and running it through
openGym's own muscle-balance engine showed it was not good enough. Three sessions a week with a
PPL split trains everything exactly once a week; the push day stacked ten sets of one pattern,
the last of them on triceps three earlier exercises had already emptied; and quads (2.8 weekly
effective sets), hamstrings (2.4), adductors, lower back, obliques and serratus were barely or
never trained.

- 🔁 **Upper / Lower / Full body** replaces it. Same three days, but pressing and pulling
  alternate instead of stacking, and everything gets hit about twice a week. Quads go 2.8 → 9.4
  weekly effective sets, hamstrings 2.4 → 10.2, and adductors, lower back, serratus and obliques
  go from nothing to trained.
- **What a floor cannot do is said out loud, not papered over.** Traps and shins have no
  floor-only exercise worth the name, and the test suite asserts they are the *only* two things
  left untrained — so an accidental gap fails a test instead of quietly appearing.
- The plans now carry tests for the properties that took the thought: frequency, no pattern
  taking more than 45 % of a session's sets, and a session length somebody will finish.
- 🐛 **Two upstream mistags corrected.** The dataset files the main squat progression
  ("potty squat") under waist/abs and a shoulder-led press ("pike-to-cobra push-up") under
  upper legs/glutes. Both sit on a variation ladder, so left alone a leg day reported itself on
  the abs row of the muscle map. Corrected by id in `lib/muscles.js`, which already exists to
  normalise the dataset's inconsistent muscle naming.

### It builds the plan now, instead of asking you to

Picking exercises is the part of a training app people are worst at, and the part an app is
best placed to do — openGym already knew the movement patterns, which of them your kit can
reach, what each one trains, and how hard every variation is. It had just never put those
together, so the answer to "what should I do" was still a library and a search box.

- 🪄 **Answer five questions, get a week.** Goal, experience, how hard you want to be hit,
  session length, days available. openGym picks the split, the exercises, the sets and reps,
  the rest between sets — and which days you rest.
- 📅 **Rest days are chosen and explained.** Four days becomes two pairs with a break in the
  middle; five puts the rest after the third day, not the fourth. Every arrangement comes with
  the sentence explaining why it is shaped that way. Push/Pull/Legs is not offered below six
  days, because three days of it trains everything once a week.
- 🔍 **It audits its own output before you see it.** After generating, it measures weekly
  effective sets per muscle with the same engine that draws the muscle map, finds what is
  under-trained, and backfills the movement that most directly fixes it — into the session
  that trains that half of the body. The preview says what it added and why.
- **The bar is scaled twice, to keep the check honest.** By how directly your kit can train a
  muscle — obliques on a bare floor are only ever a supporting muscle, so demanding the same
  number as chest would report a gap no training could close. And by how much training the week
  contains, because calling one short session "fifteen failures" tells you nothing.
- 👀 **Nothing is written until you say so.** The preview shows the week, the body map, the
  weekly sets per muscle, what it backfilled, anything still light, and what your kit cannot
  train at all. Then you choose: replace your plan, or keep both.
- **Difficulty scales with the ladder, not with an index.** The push ladder is ten rungs on a
  floor and the overhead one is four — an absolute index put "some experience" on a kneeling
  push-up and a handstand in the same session. It picks by proportion now, nudged by the goal,
  because a five-rep target implies a harder variation than a fifteen-rep one.

### A food log, with the AI part strictly optional

Training and eating are the same project, and openGym already knew your body weight — so the
missing half was what went in. `S.food` sits alongside `S.bodyweight`: a flat list of dated
entries that syncs, exports and restores with everything else.

- 🍽️ **A day at a time.** Calories and all three macros, each against its own target, with a
  Food card on Home mirroring how Body weight already reads. No target set? The macro bars show
  where your energy actually came from instead of being drawn against a number nobody chose.
- **Three ways in, and the first two need nothing.** Type it off the packet; search
  **Open Food Facts** (open data, no key, no account, no quota); or describe/photograph it and
  let a model estimate. The app is fully usable if you never touch the third.
- 🔒 **The API key is deliberately not part of your profile.** Everything in `S` is PUT to your
  server on every change and written into every JSON backup — a credential has no business in
  that payload. It lives in its own on-device slot and leaves in exactly one direction.
- **An estimate never dresses as a measurement.** Every entry records where its numbers came
  from; AI entries are flagged in the log, arrive as an editable list you approve item by item,
  and mark any portion the model inferred rather than saw. Naming what is on a plate is
  something a model does well — judging its mass from a flat photo is mostly inference.
- **The SDK is code-split**, so the 162 kB of it is downloaded by people who enable AI and
  nobody else. Protein targets can be suggested from body weight at 1.6 g/kg — offered, never
  applied, because openGym has no idea what you are training for.

### Equipment that changes the plan, not just the library

Ticking a pull-up bar used to do one thing: widen the exercise library. That is the smaller
half of the answer — a bar unlocks *vertical pulling*, a movement pattern a floor cannot train
at all, and until it is in a routine it is still not being trained.

- 🔧 **Equipment is its own section in Settings** rather than a row buried under Data.
- ✨ **Ticking new kit says what it unlocks.** openGym works out which movement patterns just
  became reachable, picks the easiest rung of each, and offers to add it to the day that
  already trains that half of the body — pulling joins your upper day, not leg day. Each
  suggestion is a switch you can decline; nothing is added without you saying so.
- **It offers the easiest rung on purpose.** Buying a bar does not make you able to do a
  one-arm chin-up, and a first session you cannot finish is the fastest way to stop using the
  new equipment. From there the normal ladder takes over.
- 🏋️ **Starter plans adapt to your kit as they load.** The Upper/Lower/Full plan now folds real
  vertical pulling into its upper day the moment you have a bar, instead of handing a bar owner
  a plan built around the absence of one.

### Pounds, and numbers that are counted rather than derived

- ⚖️ **A fresh profile starts in lb.** Only a fresh one: a profile that already chose kg keeps
  it, and switching still only relabels — logged numbers are never converted, exactly as before.
  The weigh-in slider and the 1RM calculator open at sensible pounds values instead of kilo ones.
- 🔢 **Reps and hold time sit next to the volume**, on the finish summary, every history row and
  the workout detail. Bodyweight volume is an *estimate* — your weigh-in times a coarse
  per-movement fraction — while "96 reps · 2:15" is simply what happened. Both are shown, so the
  derived number never has to be taken on trust.

### Bodyweight training that shows up in the numbers

- ⚖️ **Volume counts your body.** A floor-only session used to read 0 kg on the workout row,
  in the calendar and in the month total, because volume was weight × reps. It now counts the
  share of your body a movement holds, taken from the weigh-in openGym already asks for before
  every session — a pull-up carries all of you, a push-up about two thirds, a kneeling one
  less. It counts *mass moved*, not difficulty: a one-arm push-up moves exactly what a push-up
  moves, and is harder because of the lever. Difficulty is what the ladders are for.
- **Old sessions correct themselves.** Volume is derived on read rather than trusted from
  storage, so history logged before this counted is scored properly the moment you update.
- 🏆 **Rep PRs and hold PRs.** A PR used to mean a heavier top set, which a push-up can never
  produce — you could train at home for a year and never beat anything. Most reps ever, and
  longest hold ever, now count.
- 📈 **The exercise curve is no longer flat at zero.** Bodyweight exercises are charted by top
  set reps instead of top set weight. Clip on a dip belt and it moves back to load without
  losing the sessions underneath.

### The gear list stops lumping every weight together

"Weights and machines" was one tick that meant five different homes: a pair of dumbbells, one
kettlebell, a loaded barbell, a commercial gym, and a dip belt are different answers to "what
can you train", and one checkbox flattened them.

- 🧰 **Five kinds of load instead of one.** Dumbbells, kettlebells, barbell & plates, machines &
  cables, and a dip belt / weight vest are now separate ticks. The classifier files every
  catalogue exercise under the right one — cables, levers and sleds under machines, "weighted"
  under the vest.
- **Old profiles lose nothing.** A profile that ticked the old combined box behaves as owning
  the whole family until it edits the list, at which point it lands on the new keys. Nothing to
  migrate, nothing filtered away behind your back.

### The planner starts using what you own, what you did, and your actual calendar

- 🏋️ **Dumbbells in the plan, not just the library.** Each movement pattern knows its loaded
  equivalents (goblet squat, dumbbell bench, rows, Romanian deadlifts…), so a profile with
  weights gets them planned with the load-based progression, not just offered in a list.
- 📖 **It starts where your history says, not where a questionnaire guesses.** Any pattern you
  trained in the last 90 days starts on the rung you actually did, clamped to what your kit can
  reach. The questionnaire only decides what your history cannot.
- 📆 **Tick the days you can train.** The generator places sessions on those days, spread as far
  apart as they allow, and says so. Tick fewer days than you asked for and it trains the days
  that exist rather than pretending.
- 🔥 **The lean goal gets its shape back.** Press-and-pull supersets and a burpee finisher,
  because short rests are the point of that goal — and the finisher doesn't count against the
  coverage bar, so conditioning never crowds out a muscle.
- 🎯 **Every generated routine carries its effort target** (how many reps to leave in the tank),
  scaled by how hard you asked to be hit.

### An easy week, on purpose

- 🌙 **Take an easy week** (Settings, one tap): for seven days every session is prescribed at
  about 60 % — same movements, fewer reps, shorter holds — and says so on every exercise. The
  progression engine skips these sessions when judging progress, so resting never reads as
  failing. Home shows the banner; ending it early is one tap.
- 💪 **The workout screen shows the plan's effort target** ("aim RIR 2") while you train, and
  when your last session's ratings came in far easier than the target, it says this one should
  feel harder.

### The food log grows the boring, load-bearing conveniences

- 📈 **An Energy card in Stats**: calories per logged day against the target line, the average
  over the window, and — beside it, always — how your body weight moved over the same window.
  No invented "maintenance" arithmetic: the two numbers are shown together and the one
  subtraction that matters is yours. Days you forgot are left out, not drawn as zero, and the
  card says when the average speaks for half a window.
- 🔁 **"Log it again."** The things you actually ate lately, most-often first, one tap to relog
  with the numbers you last corrected. An empty day offers to copy yesterday whole; every
  copied entry stays individually editable.
- 📷 **Barcode scanning** where the platform can (with typing the digits always available), into
  the same free Open Food Facts lookup as text search.

### Standing back from the week

- 🪜 **A Ladders card in Stats**: one bar per movement pattern you train, from easiest variation
  to hardest, standing on the rung you most recently trained and counting only the rungs your
  kit can reach. The progress chart for training that progresses by changing the exercise.
- 📅 **A missed-day nudge.** Yesterday's planned session went unlogged and today is free? Home
  offers exactly two honest moves: do it today, or let it go — which retro-marks yesterday as a
  rest day so neither the nudge nor the calendar dot keeps litigating it.
- 📏 **Tape measurements.** Neck to calves, any subset per session, same-day corrections instead
  of duplicates, charted per site with its movement since last time. The scale says what
  changed; the tape says where — recomposition is invisible without it.

### Twelve languages, including all of the above

- 🌍 Every string this release added — the planner questions, the gear list, the food log, the
  progression's explanations, the ladders, the measurement sites — is translated into all
  eleven locale packs (de, es, fr, it, pt, pl, tr, ru, zh, ko, hi), keeping English as the
  source. The locale checker keeps the eleven key sets identical, so a key added to one
  locale can never silently miss another — a string never added to any locale still falls
  back to English, which is what the release process's string inventory exists to catch.

## v1.2.4 — 2026-08-01

The effort ratings you have been recording since v1.2.3 now answer questions, and bodyweight
training stops being treated as barbell training with the weight left at zero. Plus: creating a
profile from Settings works on an invite-only instance, which it never has.

### The effort ratings, read back as statistics

v1.2.3 let you rate how hard a set was. Nothing then read that rating back — it lived in the set
label and nowhere else. Stats now answers the question the number was recorded for.

- 📊 **An Effort card in Stats** over 30d / 90d / 1Y / all time: average effort, the share of sets
  taken close to failure, and — always alongside them — how much of your training was rated at
  all. Rating is optional and off by default, so a partly rated history is normal; an average
  without its denominator would quietly speak for sets you never rated.
- **Week by week.** The weekly average with that week's set count in the tooltip, because the
  pair is the reading: volume up with effort up is fatigue accumulating, volume up with effort
  flat is the adaptation you were training for. Weeks resting on a single rated set are dropped
  rather than drawn.
- **Where the sets land.** The spread across the scale, not just the middle of it. Half your sets
  at failure and half in warm-up territory average out to a healthy-looking number; this is the
  chart that shows it.
- 🔥 **Hard-sets mode on the muscle map.** The same body diagram, counting only sets taken near
  failure — "where did the stimulus go" rather than "where did the volume go". A muscle can lead
  on set count and still never be trained hard.
- **Effort on the exercise curve.** Each session's dot on the top-set chart fills in as less is
  left in the tank, so the same weight moved with more in reserve stops reading as a flat line.
  Exercises with enough ratings also get an Effort curve of their own.
- **One history, whichever scale you use.** Everything aggregates internally in RIR and converts
  back for display, so a history that mixes your own RIR logs with imported RPE averages as one
  series instead of two half-empty ones. RIR charts count downward on the axis, so harder sets
  sit higher.
- Translated into all 12 UI languages.

### Bodyweight training, logged the way it is done

A push-up has no weight to type, and the app asked for one anyway — every set, on a quarter of
the catalogue. Three reports (#31, #32, #33) turned out to be the same gap: the app assumed
progress lived in the load. It doesn't, for the exercises most people actually start with.

- 💪 **Exercises know they are bodyweight.** Seeded from the equipment the dataset already
  records, so push-ups, pull-ups, dips and 300-odd others arrive marked. The weight column is
  not shown, the set row is one stepper instead of two, and the "confirm your working weight"
  prompt at the end of an exercise stops asking about a weight that was never there. (#32)
- **Added weight when there is any.** A dip belt or a weighted vest is entered once in the
  exercise settings and reads as an addition — "+10 × 8", not "10×8" — everywhere it is shown
  back. With load on the belt the normal progression rules take over again, because now there
  is something to add.
- 📈 **Reps and sets are the progression.** Clean session, one more rep. Set a top of the range
  and reaching it adds a set and starts the reps over instead of climbing forever; at six sets
  it says what it should have said all along, which is that it is time for weight or a harder
  variation. No ceiling set keeps the old behaviour exactly. (#33)
- ↔️ **Reps per side.** For lunges, single-arm rows and every other unilateral movement. You
  log what you did — 16, the total — and the app shows the split, "8 per side", so the set in
  front of you is unambiguous without the rep count meaning one thing here and another there.
  The target steps in twos, 16 → 18 → 20, because half of an odd total is a rep one side never
  gets. (#31)
- Both settings travel with a shared plan, and are written to a plan file only when they
  disagree with the catalogue — every existing plan, workout and backup is read unchanged and
  none of it needs migrating.
- Translated into all 12 UI languages.

### Fixed

- **Creating a profile from Settings on an invite-only instance.** The sign-in screen asks for
  the invite code when the server needs one; the same registration reached from Settings never
  did, so it was refused with nothing on screen explaining why. It now asks on the same terms.
- **A long value no longer runs through its own label** in a settings row — "Follow the routine
  (Linear progression)" overlapped "Rule" rather than shortening itself.

## v1.2.3 — 2026-07-31

How hard a set was, in whichever of the two scales you already think in — and the ratings your
old app recorded come across with the rest of your history. Plus: the phone stops locking itself
mid-workout, the rest timer can hand time back as well as take it, and Settings is grouped by
what each thing actually affects.

### The screen stays on while you train

- ☀️ **Keep screen awake — Settings → *During a workout*, on by default.** Locking, unlocking
  and finding your place again between every set was the single most annoying thing about
  logging on a phone. The screen now stays lit for as long as a workout is running and lets go
  the moment you finish it, so nothing is held while you are not training.
- **It survives a tab switch.** Browsers release the lock whenever the page stops being visible,
  which is exactly what happens when you glance at a message. The lock is taken again each time
  the app comes back, rather than dying the first time you look away.
- **It follows the workout, not the screen you are on.** Checking Stats mid-session keeps the
  screen awake.
- **Where it isn't available, it says so.** iOS grants no wake lock in Low Power Mode, and older
  browsers have no Wake Lock API at all — the first is silent, the second shows the row disabled
  rather than offering a switch that does nothing. Needs HTTPS, like every other modern browser
  capability.

### Rest timer: take 15 seconds off, too

- ⏳ **A −15s button next to +15s.** The timer could only ever be extended or skipped outright;
  now it goes both ways. Taking off more than is left finishes the rest rather than counting
  into the negative — the same thing Skip does.
- **Rearranged so three controls fit.** The clock and the progress bar take the top row and the
  controls sit underneath: −15 and +15 together in number-line order, Skip pushed to the far
  edge so the button that ends the rest is not next to the one you tap to buy more time. On a
  wide screen it stays on one line. Tap targets are bigger than they were.
- **The bar is nearly opaque.** The set rows underneath were reading through it and making the
  clock hard to pick out.

### Settings, grouped by what it affects

- **General** (language, units) · **During a workout** (rest timer, keep screen awake, sounds,
  effort per set) · **Notifications** · **Appearance** (theme, body diagram, accent) · **Data**.
- The old grouping mixed axes: "Units & timer" put a display preference next to two workout
  behaviours, language sat under Appearance, and *Load starter plan* was buried between the
  backup actions and the destructive reset. Data now reads in the order you would use it — fill
  the plan, bring history over from another app, restore a backup, export one, wipe everything.
- Nothing was removed and no setting changed its meaning.

### Effort per set: RIR or RPE (#21)

- 🎯 **A third column on a working set, off by default.** Settings → *Effort per set* switches
  it between **Off**, **RIR** and **RPE**. It only appears on weighted rep sets: a plank or a
  treadmill row has nowhere to put it.
- **Two names for the same judgement.** RIR counts the reps you left in the tank; RPE reads the
  same effort off a 10-point scale, so RPE ≈ 10 − RIR. The setting has an (i) that lays the two
  scales side by side in a conversion table rather than explaining them in a paragraph.
- **Each set keeps the scale it was logged with.** Switching the setting changes what new sets
  ask for and nothing else — history is never silently rewritten, and a set logged as RIR 2
  still reads back as RIR 2 years later.
- **An unrated set stays unrated.** Blank and 0 are different things: RIR 0 says the set went to
  failure. So `−` on an untouched cell leaves it empty, `+` starts at the bottom of the scale
  and walks up in even steps, and stepping back off the bottom clears the cell again — a mistap
  is always undoable.
- **Nothing else reads the value.** Progression rules and estimated 1RM are unaffected; the
  rating is yours to look at, not an input to the maths.
- Upgrading keeps the column you had: a profile still carrying the old `showRir` flag — from
  this device, a sync, or a backup restored later — comes across as RIR.

### Import brings your ratings with it

- 📥 **The RPE Hevy and Strong export is no longer dropped.** An `RPE` column is read into the
  set, as is an `RIR` column if a file has one, and the import summary says how many sets
  arrived with a rating — plus where to switch the column on if it's off.
- A blank cell stays unrated rather than becoming 0. A written-out `0` counts as a rating on the
  RIR scale (a set to failure) but not on RPE, which starts at 1 — apps write 0 there to mean
  "nothing here", and reading it as an effort would stamp one on every unrated set in the file.
- Ratings above the scale are capped instead of thrown away, and junk in the column is ignored
  without losing the set.
- Backups already carried both fields and the setting, since a backup is the whole state — there
  are now tests pinning that, so it can't quietly stop being true.

## v1.2.2 — 2026-07-25

Training that moves on its own: an exercise can now be logged by time instead of reps, the
next weight follows a progression rule you choose rather than a single hard-coded hint, and
every lift carries an estimated 1RM. Plus a standalone mobile app, a shareable plan, and an
importer for your history from other apps.

### Timed sets and a timer for the set itself (#16)

- ⏱️ **Reps or time, per exercise.** Planks, hangs, wall sits, dead hangs and loaded
  carries no longer have to be filed under cardio to be timed. Each exercise in a routine
  picks its own mode, and a timed set can still carry weight for a weighted plank or a
  farmer's walk.
- ▶️ **A work timer, separate from the rest timer.** Start a timed set and it counts the
  hold down, beeping and buzzing at zero exactly as the rest timer does, then checks the
  set off itself. The two timers can never run at once — they mean opposite things.
- Finishing a hold early logs **the time you actually held**, not the target. A 38-second
  hold against a 45-second target is recorded as 38 seconds.
- The mode travels everywhere it should: routine editor, workout, history, exercise
  statistics (timed exercises chart their longest hold), the printable plan and the shared
  plan file.
- Plans made before this release are read exactly as they always were — nothing to migrate.

### Progression rules you can read (#17)

- 📈 **Pick a rule per routine, override it per exercise.** Linear progression, **Greyskull
  LP** (two straight sets plus an AMRAP final set, with double jumps and a 10 % reset),
  double progression through a rep range, or adding time for timed work. Or none at all.
- 🧾 **Every target explains itself.** "Every rep last time — 2.5 kg more." "Missed reps
  3 sessions running — reset to 55 kg and work back up." The rule is visible before you
  train, not after.
- The session opens with the right weights already in the rows, instead of suggesting them
  once you are standing at the bar.
- 🚫 **A bad session can't look like a good one.** Short reps count as a miss even when you
  checked the set off; a set you never checked counts as a miss because you did not do it.
  Nothing advances the load on a session that fell apart.
- Stalls and deloads are worked out from your log every time they are needed. Nothing is
  written back into a finished workout and no counters are stored, so fixing a mistyped set
  immediately produces the right next target.
- Lower-body lifts step up in larger jumps than upper-body ones by default, and any
  exercise can set its own step.
- Bodyweight exercises progress in **reps**, because there is no load to add to a push-up
  and no load to take off it either.

### Estimated 1RM (#18)

- 💪 **An estimated one-rep max for every lift**, in the exercise progress card (with its
  own curve you can switch to) and in the exercise detail sheet.
- It always names the set it came from — "from 90 kg × 5 on 15 Jul" — because an estimate
  off a heavy triple and one off a set of ten are very different claims.
- 🧮 **A calculator** for a set you have not done yet, so the number is reachable before
  there is any history.
- Epley by default, and it **refuses to guess above 12 reps**, where the common formulas
  disagree by double digits.
- A new best estimate is reported at the end of a workout separately from a weight PR —
  same weight for more reps is real progress, but it is not a heavier lift.

### Share a plan

- 📤 **Send someone your plan.** Plan → *Share your plan* writes a small file with your
  routines, the week schedule and any custom exercises they use — and nothing else. No
  workouts, no weigh-ins, no settings.
- Importing **merges**: shared routines arrive as new ones with fresh ids, custom exercises
  are matched by name so they are not duplicated, and your own plan is never overwritten.
  Taking the week schedule with it is optional.
- 🖨️ **A printable plan** (Save as PDF) laid out so a single exercise never breaks across
  a page.

### Fixes

- A shared plan file naming an exercise this build doesn't have can no longer take the app
  down. Unknown ids are dropped on import, anything that slips through renders as a
  placeholder you can delete, and an error boundary around the screens means a bad state is
  recoverable by switching tabs instead of reloading.
- Importing from another app converts weights **per row**, not per file. FitNotes writes the
  unit on each set, so a mixed export used to land 185 lb as 185 kg.
- Numbers follow the UI language instead of a hardcoded locale, which was putting Swiss
  apostrophes ("7'535 kg") in front of everyone. Volume stays in your own unit rather than
  switching to tonnes, which was wrong for pound profiles.
- Taking over a week schedule from a shared plan now really replaces Monday–Sunday instead
  of only the days the shared file happened to fill.
- The body-weight slider's ceiling follows your unit (300 kg / 660 lb).
- "Best: 85 Kg" is capitalised correctly again.

### One codebase, two flavors

openGym is also a standalone mobile app — and it ships as a direct APK download, not
through app stores.

- 📱 **Standalone mobile app.** The same frontend now also builds as a native iPhone /
  Android app (Capacitor) — the install-and-done flavor of openGym: no account, no server,
  no sync. Everything stays on the phone.
  - State is mirrored into a file in the app's private storage on every change, so your
    log survives even when the OS evicts WebView storage (iOS does).
  - The workout-day reminder becomes a **native notification** scheduled on the weekdays
    your plan actually has a routine — no push server involved.
  - Backups go out through the OS **share sheet** (Files, AirDrop, mail…).
  - Exercise images/animations load from the same CDN as the live demo.
  - `npm run build:mobile`, then open `android/` in Android Studio or `ios/` in Xcode —
    see **docs/MOBILE.md**. `NOTICE.md` now carries an AGPL §7 app-store exception.
- 🤖 **Android APK, no Play Store.** The official build is a signed, sideloadable APK
  (~4.5 MB) from [opengym.duarte-santos.ch](https://opengym.duarte-santos.ch) — deliberately
  store-free. docs/MOBILE.md covers building and signing your own.
- 🍎 **iOS reality check.** Apple permits no installs outside the App Store, so there is no
  iOS download; the docs explain the free options (self-hosted PWA on the home screen, or
  running the native app onto your own iPhone from Xcode).

- 📥 **Import your history from another app.** Settings → Data → *Import from another app*
  reads an export from **FitNotes** (both the Android and the FitNotes 2 iOS format),
  **Strong** and **Hevy**, and pulls body-weight history out of an **Apple Health** export.
  Anything else with a date, an exercise name and weight/reps columns is read too.
  - Every row becomes a set, grouped into workouts by date, so your history arrives with
    its real dates rather than as one lump. Hevy and Strong also carry session length, so
    the activity heatmap fills in properly.
  - Exercise names are matched against the 1,324-exercise library — parenthetical
    qualifiers like "(Barbell)" and shorthand like BB/DB are normalised, and a curated
    table covers the plain names people actually log ("Bench Press", "Squat", "RDL").
    Where a name is genuinely ambiguous it is *not* guessed at: it becomes one of your own
    exercises instead, because filing years of training under the wrong lift is worse than
    an unmatched name you can see and fix.
  - A summary shows what will happen — workouts, sets, how many exercises matched, which
    ones didn't, and whether weights need converting — before anything is written.
  - Importing is idempotent: days you already have data for are left alone, so running it
    twice, or importing from two apps, never duplicates a workout.

## v1.2.1 — 2026-07-23

A muscle map across the app, and a live demo you can try without installing anything.

- 💪 **Muscle map.** Three places now show which muscles your training actually reaches, drawn on a
  front-and-back body diagram shaded like the activity heatmap — more accent means more work.
  - **Stats → Muscle balance** aggregates a week, 30 days, 90 days or everything, lists your
    hardest-worked muscles with their set counts, and names the ones that got *nothing* in that
    period. That last list is the point of the card: the gaps are what you'd otherwise never notice.
    Tap any muscle to read its name and volume.
  - **Routine editor** previews what a session hits as you build it, so a hole in the plan shows up
    before you train around it for a month.
  - **The finish screen** shows what you just trained.
  - Load is counted in *effective sets* — a set counts fully for the exercise's target muscle and
    partially for its supporting ones — not in kilograms, because 100 kg of leg press and 12 kg of
    lateral raise say nothing about which muscle worked harder. Shading is relative within the
    period you're looking at, so the map always reads as a balance rather than an absolute.
  - Settings → Appearance → **Body diagram** switches between a male and female figure.
  - The exercise dataset spells muscles inconsistently ("delts", "deltoids" and "shoulders" are one
    muscle); all 50 spellings it uses are normalised onto the 18 the diagram can draw. Custom
    exercises, which only carry a body part, fall back to it. The geometry is ~90 kB and loads on
    demand, so the initial bundle is unchanged.
- 🐛 **Fixed: finishing a workout from its last exercise could blank the whole app.** The
  per-exercise weight sheet read the running workout without checking it was still there, and
  finishing clears it while that sheet is still on screen.
- ▶️ **Live demo** at [duartesantos8.github.io/openGym](https://duartesantos8.github.io/openGym/) —
  a browser-only build (`VITE_DEMO=1`) published to GitHub Pages on every push to `main`. It boots
  into guest mode with a seeded example profile (12 weeks of Push/Pull/Legs, weigh-ins, PRs) so
  every screen has something to show, and it never talks to a server. Passkeys, sync and the admin
  dashboard stay exclusive to self-hosted instances, which is where the backend lives.
- 🖼️ Builds can point the exercise media elsewhere via `VITE_IMG_BASE` / `VITE_GIF_BASE` — the demo
  serves the ~140 MB dataset from a CDN instead of shipping it. The default (`img/` and `gif/` next
  to the app) is unchanged.

## v1.2.0 — 2026-07-23

A complete visual redesign. Same app, same data — every screen redrawn.

### A designed interface, not an assembled one

- 🎨 **Rebuilt design system.** One type scale carrying hierarchy through size instead of making
  everything bold, a neutral surface ramp instead of saturated blue-greys, hairline separators
  instead of outlined boxes, and motion that acknowledges a press rather than animating for
  decoration. Light and dark are both first-class, and the eight accent colours now pick their
  label colour by measured contrast — the default green in light mode was failing WCAG AA on
  every primary button before.
- ✏️ **A hand-drawn icon set** (77 icons, single stroke weight, drawn on one 24×24 grid) replaces
  every emoji in the interface. Emoji render differently on each platform, sit on their own
  baseline and can't take a theme colour, which is what made the old UI feel stitched together.
  Icons inherit the surrounding text colour and optical size.
- 🏋️ **Routine icons.** Picking an icon for a routine now offers a grouped set — strength,
  equipment, cardio, recovery — instead of an emoji keyboard. Routines you already made keep
  their look: the old emoji are mapped forward automatically, so nothing to migrate and nothing
  to redo.
- ▶️ **New tab bar** with a raised Start button that turns into a pulsing orange Resume while a
  workout is running.
- 🏠 **Home reads as a plan for today** — week strip, today's session as one tappable row, body
  weight, and your streak.

### Charts

- 📈 **Axis labels, gridlines and the target-weight line are visible again** in dark mode. They
  were painted with colour variables that no longer existed, which silently fell back to black
  on black — and to no stroke at all for the lines.
- 💬 **The hover readout stays on screen.** It used to be positioned with a fixed offset that
  assumed one label width, so the first and last point pushed it under the chart's clip; it's now
  placed from its measured size and kept inside the frame, dropping below the point when the
  point sits high enough that the label would cover the value it reports.
- 🖱️ **It also goes away again** — moving off the chart now clears the readout, crosshair and
  marker, which previously stayed until you hovered somewhere else.

## v1.1.3 — 2026-07-22

Admin dashboard for self-hosters (opt-in — off by default), equipment filtering, and
workout-screen fixes.

### Admin dashboard

- 🛠️ **Admin dashboard** (Settings → Admin dashboard) for whoever runs the instance: a users
  overview with workout counts and last-active times, plus a per-user drill-down into their full
  workout history and body-weight log.
- 🟢 **Live "training now"** — see who's mid-workout in real time, with their current exercise and
  set progress, updated by a lightweight heartbeat while a workout is on screen.
- 🚫 **Disable / enable accounts** — a disabled account is signed out and locked out everywhere
  until you re-enable it.
- 🔑 **Invite-only signup** (optional) — require an invite code to create a profile; generate and
  revoke codes from the dashboard. Existing accounts are unaffected.
- ⚙️ Configured via environment: `ADMIN_UIDS` (comma-separated user ids who are admins) and
  `INVITE_ONLY=1`; both default off, so a fresh instance stays open with no admin. See
  `.env.example`. Admin access is gated by your passkey and enforced server-side.

### Exercises & workout

- 🏋️ **Filter exercises by equipment** (#6). A second filter row under the body parts lets you
  narrow the list to what you actually have — body weight, dumbbell, barbell, cable, band, and so
  on — in both the Exercises library and the exercise picker. The options adapt to what you've
  already selected and are ordered by how many exercises use them, so every combination on screen
  has results behind it and the row stays short. Building a bodyweight-only plan is now two taps
  per body part.
- 🔎 **Minimize the exercise animation during a workout** (#12). A ⤡ Minimize / ⤢ Expand button
  on the animation shrinks it to a thin strip so the set rows sit right under your thumb — no more
  scrolling past a big GIF to tick off a set. Your choice is remembered and applied to every
  exercise and future workout until you change it, so you set it once. Tapping the animation still
  pauses/plays it as before.
- ⏱️ **Fixed: the rest timer froze at 0:01** (#14) instead of counting down to the end. It also
  meant the timer could only be cleared with Skip, and a redundant "rest over" push notification
  could still fire.

## v1.1.2 — 2026-07-22

Custom exercises, full localization, and input fixes.

### Custom exercises (#11)

- ✨ **Create your own exercise** from the exercise picker or the Exercises tab: a name and a
  body part is all it takes. Your search text is pre-filled as the name, so "no match" flows
  straight into "create it".
- 📝 **Optional description** — setup, cues, anything you want to remember. It shows on the
  exercise's detail and config sheets (where a built-in exercise would show its animation),
  and it's searchable, so you can find your own exercises by their cues too.
- 🏋️ Custom exercises behave like built-in ones everywhere — routines, supersets, workout
  logging, weight suggestions, PRs, stats and history. The animation stays blank by design.
- 🏃 Pick the *cardio* body part and it logs time + speed instead of weight × reps, like the
  built-in cardio exercises.
- ✏️ Edit (rename, change body part or description) or delete your custom exercises — from
  their detail sheet in the Exercises tab, or straight from the exercise inside a routine via
  "Edit or delete this exercise". Deleting removes them from your routines; already-logged
  workouts keep their sets and still show the exercise name. (The routine sheet's old "Remove
  exercise" button is now labelled "Remove from routine", so the two are no longer confusable.)

### Localization (#7)

- 🌍 **12 UI languages**: English, Deutsch, Español, Français, Italiano, Português, Polski,
  Türkçe, Русский, 中文, 한국어, हिन्दी. Pick yours under Settings → Appearance → Language;
  the choice syncs with your profile like the theme does.
- 📖 **Localized exercise instructions** for 10 of those languages (all except German and
  Portuguese, which the upstream dataset doesn't cover yet — those fall back to English),
  covering all 1,324 exercises. Body-part filters, equipment and muscle tags are translated
  too; exercise *names* stay English (upstream limitation). Custom exercises are translated too.
- 📅 Dates, weekday and month labels follow the selected language.
- ⚡ Zero cost when unused: the app still ships English-only by default. Each UI language is a
  ~7 kB chunk and each instruction pack ~80–120 kB (gzipped), downloaded only when you switch —
  the initial bundle size is unchanged.
- 🛠️ New `scripts/build-instructions.mjs` regenerates the instruction packs from the upstream
  dataset; translations live in `frontend/src/locales/` (PRs welcome — it's one flat
  English-string → translation map per language).
- Known gaps: push notification texts (sent by the server) and plural forms in some languages
  are approximated; happy to take corrections from native speakers.

### Fixes

- ⌨️ Weight and other numeric fields now accept a comma as decimal separator ("33,5") — iOS
  decimal keyboards in many locales only offer a comma, which previously reset the field to 0.
  Partial input like "33," no longer snaps to 0 while typing. (#13)
- 📱 Fixed the exercise-config sheet (Sets / Reps / Weight, and the cardio variant) overflowing the
  screen edge on narrow phones — the Weight stepper was clipped and could make the whole page pan
  sideways in iOS Safari. Steppers now shrink to fit the viewport. (#10)
- 🛡️ Added a global horizontal-overflow guard so a single too-wide element can no longer knock the
  page layout off-scale.

## v1.1.1 — 2026-07-21

Reliability fixes for the push notifications shipped in v1.1.0, found through live testing:

- 🌍 Workout day reminder now fires by each user's own browser-detected timezone instead of a
  single server-wide one — works correctly regardless of where the server runs, and follows you
  automatically if you travel.
- 💾 Settings changes (like the reminder time) are flushed to the server immediately when the tab
  backgrounds or closes, instead of relying solely on a 1.5s debounce that could get cut short.
- ⏱️ Reminder check tightened from a 60s to a 10s interval, and pushes are now marked
  `urgency: 'high'` — cuts avoidable delay on top of it, though delivery time is ultimately up to
  Apple/Google's push relay.
- 🪵 Push send failures are now logged instead of silently swallowed.

## v1.1.0 — 2026-07-21

- 🐳 Prebuilt Docker images published to `ghcr.io/duartesantos8/opengym-{api,web}` (amd64 + arm64)
  via GitHub Actions, so self-hosting no longer requires building from source. `docker compose pull`
  grabs them; `docker compose up -d --build` still builds locally if you'd rather.
- 🔔 Push notifications: rest-timer-over alert (fires even if the app is closed) and an optional
  daily reminder on days you have a workout planned but haven't logged one yet. Opt in per-profile
  in Settings — requires a signed-in passkey profile. Backend gains one dependency (`web-push`);
  VAPID keys are generated on first run.
- 🐛 Fixed the rest timer stalling when the tab/app is backgrounded — it's now anchored to a real
  timestamp instead of a plain per-second counter, so it stays accurate after you come back.

## v1.0.0 — 2026-07-20

First public release. A complete, self-hostable gym & body-weight tracker.

**Highlights**
- ⚖️ Body-weight tracking with an interactive chart + goal line
- 🏋️ Weekly routine planner over 1,324 exercises with animated demos
- ▶️ Guided workouts: body-weight check-in, pre-filled weights, rest timer, PR detection, per-exercise weight tracking
- 🔗 Supersets and 🏃 cardio (time + speed) logging
- 🗓️ Per-day rescheduling without touching your weekly plan
- 🟩 GitHub-style activity heatmap (by time trained)
- 🔑 Passkey (WebAuthn) login with per-profile data that syncs across devices
- 🎨 Light/dark themes + 8 accent colors, synced to your profile
- 📦 JSON export/import, guest mode, PWA install, no telemetry

**Stack**
- React 19 + Vite (React Router, Zustand)
- Node backend, no framework, single dependency (`@simplewebauthn/server`), JSON-file storage
- nginx + multi-stage Docker so `docker compose up` builds and serves everything

**Notes**
- Exercise media (~140 MB) is fetched from [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) on first run.
- Licensed under GNU AGPL v3.0.
