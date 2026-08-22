// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per
// planned weekday — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n.js'
import { nudgeLadder, nudgePreview, NUDGE_ID_BASE, NUDGE_ID_MAX, NUDGE_PREVIEW_ID, NUDGE_ACTION_TYPE, NOT_HOME_ACTION } from './nudge.js'
import { mealReminders, MEAL_ID_BASE, MEAL_ID_MAX } from './meals.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'

const FILE = 'opengym-state.json'

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

// (Re)schedule the workout-day reminder: one repeating notification per weekday that has a
// routine in the weekly plan. Cheap enough to run after any state change — the plan or the
// reminder time may just have been edited. `interactive` gates the OS permission prompt to
// the Settings toggle; a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: 100 + d })) }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const [hour, minute] = (r.time || '08:00').split(':').map(Number)
    const notifications = Object.entries(S.week || {})
      .filter(([, rid]) => rid && (S.routines || []).some(x => x.id === rid))
      .map(([day, rid]) => ({
        id: 100 + Number(day),
        title: t('Workout day'),
        body: t('{0} is on the plan today — let’s go!', S.routines.find(x => x.id === rid).name),
        // Capacitor weekdays are 1 (Sunday) … 7 (Saturday); S.week uses getDay() 0…6.
        schedule: { on: { weekday: Number(day) + 1, hour, minute }, allowWhileIdle: true },
      }))
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

/* ---- the nudge ladder ----
   The escalating evening reminder (lib/nudge.js). Nothing here decides anything: the ladder
   is computed from state, this just makes the OS agree with it — cancel the whole reserved
   id range, schedule what the ladder currently says. That is deliberately blunt rather than
   clever, because it is the only thing that can be correct: the store re-runs this after
   every state change, so "a workout was started" and "the plan was edited" and "bedtime
   moved" all take the same path, and there is never a stale rung left behind that we forgot
   to cancel by hand.

   Every rung carries the "Not home" button, so the one guess this feature makes about your
   life — what time you get in — is a single tap to correct rather than a reason to turn the
   whole thing off. */
const NUDGE_IDS = []
for (let i = NUDGE_ID_BASE; i <= NUDGE_ID_MAX; i++) NUDGE_IDS.push({ id: i })

// The store persists on *every* state change — every set ticked, every rep edited — and a
// blind resync is 70 cancels and a reschedule across the native bridge each time. The ladder
// is pure, so computing it is free by comparison: if it comes out identical to what is
// already on the schedule, there is nothing to say to the OS. Mid-workout, when the day's
// rungs are already gone, that is every single persist.
let lastSynced = null

export async function syncNudges(S, interactive = false) {
  try {
    const want = S?.nudge?.on ? JSON.stringify(nudgeLadder(S)) : '[]'
    if (!interactive && want === lastSynced) return true
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: NUDGE_IDS }).catch(() => {})
    lastSynced = want
    if (!S?.nudge?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') { lastSynced = null; return false }
    // Re-registered on every sync rather than once at boot: the button is a translated
    // string, and a language switch has to reach the notifications already on the schedule.
    await LocalNotifications.registerActionTypes({
      types: [{ id: NUDGE_ACTION_TYPE, actions: [{ id: NOT_HOME_ACTION, title: t('Not home') }] }],
    }).catch(() => {})
    const list = JSON.parse(want).map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      actionTypeId: NUDGE_ACTION_TYPE,
      extra: { iso: n.iso },
      schedule: { at: new Date(n.at), allowWhileIdle: true },
    }))
    if (list.length) await LocalNotifications.schedule({ notifications: list })
    return true
  } catch (e) { lastSynced = null; return false }
}

// Fire the tone's harshest line right now, so it can be read before it is lived with.
export async function previewNudge(S) {
  try {
    const msg = nudgePreview(S)
    if (!msg) return false
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    await LocalNotifications.registerActionTypes({
      types: [{ id: NUDGE_ACTION_TYPE, actions: [{ id: NOT_HOME_ACTION, title: t('Not home') }] }],
    }).catch(() => {})
    await LocalNotifications.schedule({
      notifications: [{
        id: NUDGE_PREVIEW_ID, title: msg.title, body: msg.body,
        actionTypeId: NUDGE_ACTION_TYPE, extra: {},
        schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true },
      }],
    })
    return true
  } catch (e) { return false }
}

/* ---- meal reminders ----
   Same contract as the nudge ladder, different subject: lib/meals.js computes the exact
   list (mealtime menu, then a "what did you eat?" follow-up that a logged meal silences),
   and this cancels the reserved range and schedules that list — fingerprinted, because the
   store re-syncs after every state change and most changes move no meal. Tapping one is
   handled in App.jsx: it just opens the Meals screen, where the answer belongs. */
const MEAL_IDS = []
for (let i = MEAL_ID_BASE; i <= MEAL_ID_MAX; i++) MEAL_IDS.push({ id: i })
export const MEAL_ACTION_TYPE = 'meal'
let lastMeals = null

export async function syncMeals(S, interactive = false) {
  try {
    const want = S?.meals?.on ? JSON.stringify(mealReminders(S)) : '[]'
    if (!interactive && want === lastMeals) return true
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: MEAL_IDS }).catch(() => {})
    lastMeals = want
    if (!S?.meals?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') { lastMeals = null; return false }
    const list = JSON.parse(want).map(n => ({
      id: n.id, title: n.title, body: n.body,
      actionTypeId: MEAL_ACTION_TYPE, extra: { iso: n.iso, slot: n.slot },
      schedule: { at: new Date(n.at), allowWhileIdle: true },
    }))
    if (list.length) await LocalNotifications.schedule({ notifications: list })
    return true
  } catch (e) { lastMeals = null; return false }
}

// A tapped meal reminder should land the person on the Meals screen with the log one tap
// away — the notification asked a question, this is where it gets answered.
let mealWired = false
export async function wireMealActions(onOpen) {
  if (!MOBILE || mealWired) return
  mealWired = true
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    LocalNotifications.addListener('localNotificationActionPerformed', ev => {
      if (ev?.notification?.actionTypeId === MEAL_ACTION_TYPE) onOpen(ev?.notification?.extra?.iso || null)
    })
  } catch (e) { /* web build */ }
}

// "Not home" tapped from the shade: hand the day back to the caller, which defers it in
// state — and the resulting persist reschedules the rest of the evening an hour later.
let nudgeWired = false
export async function wireNudgeActions(onNotHome) {
  if (!MOBILE || nudgeWired) return
  nudgeWired = true
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    LocalNotifications.addListener('localNotificationActionPerformed', ev => {
      if (ev?.actionId === NOT_HOME_ACTION) onNotHome(ev?.notification?.extra?.iso || null)
    })
  } catch (e) { /* web build */ }
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}

/* ---- the Android back gesture ----
   Without a listener, Capacitor's default for the hardware/gesture back is to close the
   app — no matter that a sheet was open or the user was three screens deep. A back-swipe
   means "one step out": the top sheet first, then the previous screen, and only from Home
   with nothing open does it hand control back to the OS — as a minimize, never an exit.
   (State is saved either way; the app vanishing mid-flow is still the wrong answer.) */
let backWired = false
export async function wireBackButton(step) {
  if (!MOBILE || backWired) return
  backWired = true
  try {
    const { App } = await import('@capacitor/app')
    App.addListener('backButton', () => step())
  } catch (e) { /* web build, or plugin unavailable — browser back works natively there */ }
}

export async function minimizeApp() {
  try {
    const { App } = await import('@capacitor/app')
    await App.minimizeApp()
  } catch (e) { /* iOS has no minimize and no back gesture to wire — nothing to do */ }
}
