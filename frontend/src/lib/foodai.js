// Optional: read a meal from a sentence or a photo.
//
// This is the one part of openGym that talks to somebody else's server, so it is off until
// you switch it on, it runs on YOUR API key, and the free paths (typing it in, searching the
// food database) stay fully usable if you never touch it.
//
// Three deliberate choices:
//
//  1. The key is NOT part of S. Everything in S is PUT to your own server on every change and
//     lands in every JSON backup and every shared plan file. A credential does not belong in
//     a sync payload, so it lives in its own localStorage entry, on this device only, and
//     leaves in exactly one direction: to api.anthropic.com.
//  2. The SDK is imported dynamically. Someone who never enables this never downloads it —
//     the same reason locale packs and the body diagram are lazy-loaded.
//  3. Everything it returns is an estimate and is labelled as one (`src: 'ai'`). Naming the
//     food on a plate is something a model does well; judging its mass from a flat photo is
//     mostly inference, and the app should never present the two as equally solid.

import { normalizeEntry } from './food.js'

const KEY_STORE = 'gym_ai_key'
const MODEL_STORE = 'gym_ai_model'

// Opus 5 unless you say otherwise. Cheaper models read a plate perfectly well and cost a
// fraction as much — but that is a call about your money, so it is offered in Settings
// rather than made on your behalf.
export const DEFAULT_MODEL = 'claude-opus-5'
export const AI_MODELS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', hint: 'Most capable. Roughly 1¢ a photo.' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', hint: 'A good middle. Cheaper than Opus.' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', hint: 'Fastest and cheapest — a fraction of a cent a photo.' },
]

export const getKey = () => { try { return localStorage.getItem(KEY_STORE) || '' } catch { return '' } }
export const setKey = k => {
  try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE) } catch { /* */ }
}
export const hasKey = () => !!getKey()
export const getModel = () => { try { return localStorage.getItem(MODEL_STORE) || DEFAULT_MODEL } catch { return DEFAULT_MODEL } }
export const setModel = m => { try { localStorage.setItem(MODEL_STORE, m || DEFAULT_MODEL) } catch { /* */ } }

/* ---------- what we ask for ---------- */

// A strict tool is how the answer comes back as data rather than prose. `strict: true` with
// `additionalProperties: false` means the arguments validate exactly against this shape, so
// there is no JSON to salvage out of a paragraph.
const LOG_FOOD_TOOL = {
  name: 'log_food',
  description: 'Record every distinct food and drink item identified, with its nutrition.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct food or drink. Split a composite meal into its parts.',
        items: {
          type: 'object',
          properties: {
            n: { type: 'string', description: 'Short name of the food, e.g. "Grilled chicken breast".' },
            q: { type: 'string', description: 'Portion actually present, e.g. "150 g" or "1 medium".' },
            kcal: { type: 'number', description: 'Calories for that portion.' },
            p: { type: 'number', description: 'Protein in grams for that portion.' },
            c: { type: 'number', description: 'Carbohydrate in grams for that portion.' },
            f: { type: 'number', description: 'Fat in grams for that portion.' },
            confident: { type: 'boolean', description: 'False when the portion size is a guess rather than something visible or stated.' },
          },
          required: ['n', 'q', 'kcal', 'p', 'c', 'f', 'confident'],
          additionalProperties: false,
        },
      },
      note: { type: 'string', description: 'One short sentence on anything uncertain, or an empty string.' },
    },
    required: ['items', 'note'],
    additionalProperties: false,
  },
}

const SYSTEM = [
  'You estimate the nutrition of food for a training log.',
  'Break a meal into its distinct components and give each one its own entry.',
  'Judge portion size from what is actually visible or stated — plate size, cutlery and packaging are useful scale references.',
  'Prefer a plain, honest estimate over a precise-looking one: round sensibly and set confident=false whenever the portion is inferred rather than seen.',
  'If the image or text contains no food at all, return an empty items array and say so in note.',
  'Always answer by calling the log_food tool.',
].join(' ')

/* ---------- images ---------- */

// Downscale before sending. A phone photo is several megapixels and costs tokens in
// proportion to its area, while adding nothing — the model does not need to count grains of
// rice, and 1024px is past the point where more pixels change the answer.
export const MAX_EDGE = 1024

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = e => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

/** Shrink to fit MAX_EDGE and return base64 JPEG (no data: prefix), as the API wants it. */
export async function shrinkToBase64(file) {
  const img = await fileToImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
}

/* ---------- the call ---------- */

let clientPromise = null
async function getClient(key) {
  // Imported here, not at module scope, so the SDK is fetched the first time somebody
  // actually uses this and never by anyone who does not.
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  return new Anthropic({
    apiKey: key,
    // There is no openGym server in the mobile build and no server at all in guest mode, so
    // the request goes straight from the app. The key is the user's own, on their own device.
    dangerouslyAllowBrowser: true,
  })
}

/**
 * Estimate a meal. `text` and/or `imageBase64` — at least one.
 * Returns { items: [normalised entries], note } and throws with a readable message.
 */
export async function estimateMeal({ text, imageBase64, model } = {}) {
  const key = getKey()
  if (!key) throw new Error('No API key set — add one in Settings to use AI.')
  if (!text && !imageBase64) throw new Error('Describe the meal or add a photo.')

  const content = []
  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } })
  }
  content.push({
    type: 'text',
    text: text
      ? `Estimate the nutrition of this: ${text}`
      : 'Estimate the nutrition of the food in this photo.',
  })

  const client = await getClient(key)
  let res
  try {
    res = await client.messages.create({
      model: model || getModel(),
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      // Reading a plate is perception plus recall, not hard reasoning — low effort keeps the
      // answer as good and the bill markedly smaller.
      output_config: { effort: 'low' },
      tools: [LOG_FOOD_TOOL],
      messages: [{ role: 'user', content }],
    })
  } catch (e) {
    throw new Error(friendlyError(e))
  }

  // A refusal comes back as a normal 200 with no tool call, so check before reading content.
  if (res.stop_reason === 'refusal') throw new Error('That request was declined. Try describing the meal in words.')

  const call = (res.content || []).find(b => b.type === 'tool_use' && b.name === 'log_food')
  if (!call) throw new Error('No estimate came back. Try a clearer photo, or type it instead.')
  return parseResult(call.input)
}

/** Tool arguments → log entries. Separated out so the mapping is testable without a network. */
export function parseResult(input) {
  const raw = (input && Array.isArray(input.items)) ? input.items : []
  const items = raw
    .map(it => ({ ...normalizeEntry({ ...it, src: 'ai' }), confident: it.confident !== false }))
    .filter(e => e.kcal > 0 || e.p > 0 || e.c > 0 || e.f > 0)
  return { items, note: String((input && input.note) || '').slice(0, 200) }
}

/** Turn an SDK error into something worth showing a person mid-meal. */
export function friendlyError(e) {
  const status = e && e.status
  if (status === 401) return 'That API key was rejected. Check it in Settings.'
  if (status === 403) return 'That key is not allowed to use this model.'
  if (status === 429) return 'Rate limited by the API — wait a moment and try again.'
  if (status === 400) return 'The API rejected that request' + (e && e.message ? `: ${e.message}` : '.')
  if (status >= 500) return 'The API is having trouble. Try again shortly.'
  if (e && /network|fetch|Failed to fetch/i.test(e.message || '')) return 'No connection to the API.'
  return (e && e.message) || 'Something went wrong.'
}
