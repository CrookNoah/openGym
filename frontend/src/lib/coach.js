// The coach you can talk to.
//
// Everything else in this app is a deterministic engine: the planner, the progression
// ladders, the coverage audit, the trend maths. Those are auditable and they are right, and
// this file does not replace any of them. What it adds is the thing they cannot do — take a
// sentence ("why has my bench stalled?", "I've got twenty minutes and a hotel room") and
// turn it into an answer grounded in your actual training.
//
// Three rules hold the whole design together:
//
//  1. **It cannot invent your data.** coachContext() builds a compact, factual snapshot from
//     state — trend, verdict, plan, recent sessions, adherence — and the system prompt says
//     plainly that every number must come from that snapshot or from a tool result. There is
//     nothing for the model to guess with, which is most of the way to it not guessing.
//  2. **It cannot write to your state.** Read tools (searching the exercise database, pulling
//     an exercise's history) run for real. Write tools never execute: they come back to the
//     UI as *proposals* with a confirm button, and the model is told so. The AI's opinion
//     about your Tuesday and your Tuesday remain two different things.
//  3. **It cannot pretend the free app needs it.** No key, no coach — and every deterministic
//     verdict, card and number keeps working exactly as before.
//
// Same key handling as the food estimator (lib/foodai.js): your own key, in its own
// localStorage slot, never in S, never in a backup. The SDK is imported dynamically so
// somebody who never opens the coach never downloads it.

import { EXDB, exOr } from './exercises.js'
import { filterByGear, gearSummary } from './gear.js'
import { todayISO, isoOf, DAYN, fmtNum } from './format.js'
import { effectiveRoutineId, lastEntryFor, volOf, setsDone } from './history.js'
import { weekAudit, routineMuscles, sessionMinutes } from './week.js'
import { MUSCLE_NAME } from './muscles.js'
import { targetOf } from './food.js'
import { goalOf, goalProgress, paceVerdict, adherence, trendWeight, verdictLine, proposeAdjustment } from './goal.js'
import { getKey, getModel, hasKey, friendlyError } from './foodai.js'

/* ============================ the snapshot ============================ */

const round = (n, d = 1) => (n == null ? null : Math.round(n * Math.pow(10, d)) / Math.pow(10, d))

/**
 * Everything the coach is allowed to know, as plain data. Pure, bounded and testable — and
 * the reason the model has no room to make things up. Deliberately compact: this rides along
 * with every message, so it holds the shape of the training rather than the whole log.
 */
export function coachContext(S, now = Date.now()) {
  const unit = S.unit || 'lb'
  const g = goalOf(S)
  const p = g ? goalProgress(S, now) : null
  const v = g ? paceVerdict(S, now) : null
  const a = adherence(S, 7, now)
  const tgt = targetOf(S)
  const audit = weekAudit(S)
  const routines = S.routines || []

  const week = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const r = routines.find(x => x.id === (S.week || {})[d])
    return { day: DAYN[d], session: r ? r.name : null, exercises: r ? r.ex.length : 0,
      minutes: r ? sessionMinutes(r, S.restSec) : null,
      trains: r ? routineMuscles(r, 3).map(m => MUSCLE_NAME[m]) : [] }
  })

  const recent = (S.workouts || []).slice(-6).reverse().map(w => ({
    date: w.d, name: w.name || null,
    sets: setsDone(w), volume: round(volOf(w), 0),
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
  }))

  return {
    today: todayISO(),
    weekday: DAYN[new Date(now).getDay()],
    unit,
    bodyweight: { trend: round(trendWeight(S), 1), latest: round((((S.bodyweight || []).slice(-1)[0]) || {}).w, 1) },
    goal: g ? {
      kind: g.kind, startWeight: g.startW, targetWeight: g.targetW, plannedRatePerWeek: g.rate,
      startedOn: g.startD, changedSoFar: p ? p.done : null, toGo: p ? p.toGo : null,
      actualRatePerWeek: p ? round(p.rate, 2) : null, weeksIn: p ? Math.round(p.weeksIn) : null,
      etaWeeks: p ? p.etaWeeks : null, verdict: v ? v.state : null,
      calorieAdjustments: (g.adjustments || []).length,
    } : null,
    diet: tgt ? {
      target: tgt, loggedDaysLast7: a.loggedDays, averageIntakeLast7: a.avgKcal,
      overTargetBy: a.overBy,
    } : null,
    training: {
      gear: gearSummary(S, x => x),
      plannedPerWeek: a.sessionsPlanned, doneLast7: a.sessionsDone,
      week,
      notTrainedThisWeek: audit ? audit.missed.map(m => MUSCLE_NAME[m]) : [],
      lightThisWeek: audit ? audit.light.map(m => MUSCLE_NAME[m]) : [],
      outOfReachForYourKit: audit ? audit.untrainable.map(m => MUSCLE_NAME[m]) : [],
    },
    recentSessions: recent,
  }
}

/* ============================ the tools ============================ */

// Read tools run for real; write tools never do. A write comes back to the UI as a proposal
// with a confirm button, and the model is told that is what happened — so it says "tap to
// apply" rather than "done", and your plan only ever changes because you changed it.
export const WRITE_TOOLS = ['swap_days', 'set_day', 'add_exercise', 'set_calorie_target', 'take_calorie_adjustment']

const TOOLS = [
  {
    name: 'search_exercises',
    description: 'Search the exercise database for movements matching a name, muscle or piece of equipment. Returns only exercises the user can actually do with the equipment they own. Use this before naming any exercise — never invent one.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text: an exercise name, a muscle, or a movement pattern.' },
        limit: { type: 'integer', description: 'How many to return, 1 to 15.' },
      },
      required: ['query', 'limit'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_exercise_history',
    description: 'The user\'s recent logged sets for one exercise, newest first, to answer questions about progress or a stall.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        exercise_id: { type: 'string', description: 'The id from search_exercises.' },
        sessions: { type: 'integer', description: 'How many past sessions to return, 1 to 10.' },
      },
      required: ['exercise_id', 'sessions'],
      additionalProperties: false,
    },
  },
  {
    name: 'swap_days',
    description: 'Propose swapping the sessions on two weekdays. This is a proposal shown to the user with a confirm button — it does not take effect by itself.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        day_a: { type: 'integer', description: 'Weekday 0-6, Sunday is 0.' },
        day_b: { type: 'integer', description: 'Weekday 0-6, Sunday is 0.' },
        why: { type: 'string', description: 'One short sentence the user will read on the confirm button.' },
      },
      required: ['day_a', 'day_b', 'why'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_day',
    description: 'Propose putting a specific routine on a weekday, or making it a rest day. A proposal, confirmed by the user.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        day: { type: 'integer', description: 'Weekday 0-6, Sunday is 0.' },
        routine_name: { type: 'string', description: 'The exact name of one of the user\'s routines, or "rest".' },
        why: { type: 'string', description: 'One short sentence for the confirm button.' },
      },
      required: ['day', 'routine_name', 'why'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_exercise',
    description: 'Propose adding an exercise to one of the user\'s routines. A proposal, confirmed by the user.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        routine_name: { type: 'string', description: 'The exact name of one of the user\'s routines.' },
        exercise_id: { type: 'string', description: 'The id from search_exercises.' },
        sets: { type: 'integer', description: 'Working sets, 1 to 6.' },
        reps: { type: 'integer', description: 'Target reps per set, 1 to 30.' },
        why: { type: 'string', description: 'One short sentence for the confirm button.' },
      },
      required: ['routine_name', 'exercise_id', 'sets', 'reps', 'why'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_calorie_target',
    description: 'Propose a new daily calorie and macro target. A proposal, confirmed by the user. Do not use this to make small stall adjustments — take_calorie_adjustment already knows the safe step and the floor.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        kcal: { type: 'integer', description: 'Daily calories.' },
        protein: { type: 'integer', description: 'Daily protein in grams.' },
        carbs: { type: 'integer', description: 'Daily carbohydrate in grams.' },
        fat: { type: 'integer', description: 'Daily fat in grams.' },
        why: { type: 'string', description: 'One short sentence for the confirm button.' },
      },
      required: ['kcal', 'protein', 'carbs', 'fat', 'why'],
      additionalProperties: false,
    },
  },
  {
    name: 'take_calorie_adjustment',
    description: 'Offer the adjustment the app itself has already worked out for a stalled goal, with its own floor and drift cap applied. Prefer this over set_calorie_target whenever the goal has stalled. Returns nothing to propose if the app does not think an adjustment is warranted.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
]

/* ============================ running the tools ============================ */

function runSearch(S, input) {
  const q = String(input.query || '').toLowerCase().trim()
  const limit = Math.max(1, Math.min(15, Number(input.limit) || 8))
  const words = q.split(/\s+/).filter(Boolean)
  const pool = filterByGear(S, EXDB)
  const scored = pool.map(ex => {
    const hay = `${ex.n} ${ex.bp || ''} ${ex.tm || ''} ${ex.eq || ''}`.toLowerCase()
    let score = 0
    words.forEach(w => { if (hay.includes(w)) score += hay.startsWith(w) ? 3 : 1 })
    if (ex.n.toLowerCase() === q) score += 10
    return { ex, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
  return scored.map(({ ex }) => ({ id: ex.id, name: ex.n, bodyPart: ex.bp, target: ex.tm, equipment: ex.eq }))
}

function runHistory(S, input) {
  const id = String(input.exercise_id || '')
  const want = Math.max(1, Math.min(10, Number(input.sessions) || 5))
  const out = []
  for (let i = (S.workouts || []).length - 1; i >= 0 && out.length < want; i--) {
    const w = S.workouts[i]
    const e = (w.entries || []).find(x => x.id === id)
    if (!e) continue
    out.push({
      date: w.d,
      sets: (e.sets || []).filter(s => s.done && !s.wu).map(s => ({ weight: s.w, reps: s.r, seconds: s.sec })),
      target: e.target ? { sets: e.target.sets, reps: e.target.reps, weight: e.target.weight } : null,
    })
  }
  return { exercise: exOr(id).n, sessions: out, note: out.length ? null : 'No logged sessions for this exercise.' }
}

/**
 * Execute one tool call. Read tools return real data; write tools return a note saying the
 * proposal has been shown, and hand the proposal back for the UI to render.
 * Returns { result, proposal }.
 */
export function runTool(S, name, input) {
  switch (name) {
    case 'search_exercises':
      return { result: { exercises: runSearch(S, input) }, proposal: null }
    case 'get_exercise_history':
      return { result: runHistory(S, input), proposal: null }
    case 'take_calorie_adjustment': {
      const adj = proposeAdjustment(S)
      if (!adj) return { result: { proposed: false, note: 'The app does not think an adjustment is warranted right now. Explain why rather than proposing a number yourself.' }, proposal: null }
      if (adj.kind !== 'kcal') return { result: { proposed: false, diagnosis: adj, note: 'The app diagnosed something other than the target being wrong. Tell the user this, in your own words.' }, proposal: null }
      return {
        result: { proposed: true, from: adj.from, to: adj.to, note: 'Shown to the user as a confirm button. Do not repeat the numbers at length; just say it is there to tap.' },
        proposal: { kind: 'adjust', adj, why: `${adj.from} → ${adj.to} kcal` },
      }
    }
    default:
      if (WRITE_TOOLS.includes(name)) {
        return {
          result: { proposed: true, note: 'Shown to the user as a confirm button. It has NOT been applied. Say it is there to tap, and do not claim it is done.' },
          proposal: { kind: name, input, why: input.why || '' },
        }
      }
      return { result: { error: `Unknown tool ${name}` }, proposal: null }
  }
}

/* ============================ the conversation ============================ */

const SYSTEM = `You are the coach inside openGym, a training and nutrition app. You are talking to the person whose data appears below.

Ground rules, in order of importance:

1. Every number you state must come from the CONTEXT below or from a tool result. If you do not have a figure, say you do not have it — never estimate one and present it as theirs.
2. Be brief. Two or three sentences is usually the whole answer. This is read on a phone, often between sets.
3. Before naming any exercise, find it with search_exercises. The app only contains exercises the user can do with the equipment they own, and an exercise you invent is one they cannot tap.
4. Anything that changes their plan or targets is a proposal: the tool shows a confirm button and nothing happens until they tap it. Say "tap to apply", never "done" or "I've changed it".
5. When their goal has stalled, call take_calorie_adjustment rather than inventing a number — the app already knows the safe step, the floor, and whether the real problem is adherence rather than the target.
6. You are not a clinician. For pain that persists, or anything that sounds like an injury rather than soreness, say plainly that it is worth seeing a professional, and offer a substitution in the meantime.
7. Their training goal is theirs. Give an honest opinion when the evidence is clear — a deficit is what drives fat loss, training and protein are what keep the muscle — but do not lecture, and do not moralise about food.

CONTEXT (this person's actual data):
`

/**
 * One turn of the conversation.
 *
 * `history` is prior turns as [{ role, content }]. `onDelta(text)` streams the reply as it
 * arrives. Returns { text, proposals, history } — the new history including this turn, so
 * the caller can pass it straight back next time.
 */
export async function askCoach({ S, history = [], question, onDelta, signal }) {
  if (!hasKey()) throw new Error('Add your Anthropic API key in Settings to use the coach.')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true })
  const model = getModel()

  const system = [
    // The rules and the snapshot are stable across the whole conversation, so they are one
    // cacheable prefix — follow-up turns pay for the question, not the context.
    { type: 'text', text: SYSTEM + JSON.stringify(coachContext(S), null, 1), cache_control: { type: 'ephemeral' } },
  ]
  const messages = [...history, { role: 'user', content: question }]
  const proposals = []
  let text = ''

  // A manual loop rather than the SDK tool runner: write tools must *not* execute, and the
  // loop has to hand their proposals back to React instead. Read tools run and feed straight
  // back in, so the model can look something up and answer in one turn.
  for (let hop = 0; hop < 4; hop++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 8000,
      system,
      tools: TOOLS,
      messages,
      ...(model === 'claude-haiku-4-5' ? {} : { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }),
    }, signal ? { signal } : undefined)

    stream.on('text', d => { text += d; onDelta && onDelta(d) })
    let res
    try { res = await stream.finalMessage() } catch (e) { throw new Error(friendlyError(e)) }

    if (res.stop_reason === 'refusal') throw new Error('That request was declined. Try rephrasing it.')
    messages.push({ role: 'assistant', content: res.content })
    const calls = (res.content || []).filter(b => b.type === 'tool_use')
    if (!calls.length) break

    const results = calls.map(c => {
      const { result, proposal } = runTool(S, c.name, c.input || {})
      if (proposal) proposals.push({ ...proposal, id: c.id })
      return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(result) }
    })
    messages.push({ role: 'user', content: results })
  }

  return { text: text.trim(), proposals, history: messages }
}

/* ============================ the weekly review ============================ */

const REVIEW_SYSTEM = `You are the coach inside openGym, writing this person's weekly review.

Write 3 to 5 short sentences, in this order: what actually happened this week, what is working, and the single most useful thing to change. No headings, no bullet points, no preamble, no sign-off — just the paragraph.

Every figure you use must come from the DATA below. If the data says the verdict is "early", say plainly that there is not enough yet to judge and tell them what would make next week's review say something. Do not congratulate someone whose trend is flat, and do not scold someone who is on track. Never mention calories being cut unless the DATA contains an adjustment.

DATA:
`

/**
 * The week in the coach's words, from the week's real numbers. Falls back to nothing when
 * there is no key — the deterministic verdictLine() is what the card shows then, and it is
 * what this is checked against.
 */
export async function weeklyReview(S, now = Date.now()) {
  if (!hasKey()) return null
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true })
  const model = getModel()
  const ctx = coachContext(S, now)
  const line = verdictLine(S, now)
  const data = { ...ctx, deterministicVerdict: line ? line[0] : null, adjustmentOffered: proposeAdjustment(S, now) }
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1000,
      system: REVIEW_SYSTEM + JSON.stringify(data, null, 1),
      ...(model === 'claude-haiku-4-5' ? {} : { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }),
      messages: [{ role: 'user', content: 'Write this week\'s review.' }],
    })
    if (res.stop_reason === 'refusal') return null
    return (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || null
  } catch (e) {
    return null   // the deterministic verdict is always there underneath
  }
}
