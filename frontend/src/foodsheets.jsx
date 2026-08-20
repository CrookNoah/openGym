// Sheets for the food log.
//
// Kept out of sheets.jsx purely for size — that file is already the app's largest, and
// nutrition is a self-contained corner of it. Everything here follows the same conventions:
// a component plus a thin `xSheet()` opener, and no direct store imports at module scope.

import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { fmtNum, fmtDate, todayISO } from './lib/format.js'
import { MACROS, MACRO_NAME, SOURCES, addFood, updateFood, removeFood, normalizeEntry, kcalFromMacros, targetOf, suggestProtein, recentFoods, isEstimate } from './lib/food.js'
import { searchFood, scaleProduct, lookupBarcode } from './lib/foodsearch.js'
import { hasKey, estimateMeal, shrinkToBase64, AI_MODELS, getModel, setModel, getKey, setKey } from './lib/foodai.js'
import Icon from './components/Icon.jsx'
import { Button, Stepper, Switch, Row, SelectRow, NumberField } from './components/ui.jsx'
import { confirmSheet } from './sheets.jsx'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/* ============================ the four numbers ============================ */
// Shared by every way in: type it, pick it from the database, accept an AI estimate. The
// last two pre-fill it — which is the point. Nothing is logged you have not seen.
function MacroFields({ v, setV }) {
  const implied = kcalFromMacros(v)
  const off = v.kcal > 0 && implied > 0 && Math.abs(implied - v.kcal) > Math.max(30, v.kcal * 0.15)
  return <>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Calories')} value={v.kcal || 0} step={10} decimal={false} onChange={n => setV(x => ({ ...x, kcal: n }))} />
      <Stepper label={t('Protein (g)')} value={v.p || 0} step={1} onChange={n => setV(x => ({ ...x, p: n }))} />
    </div>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Carbs (g)')} value={v.c || 0} step={1} onChange={n => setV(x => ({ ...x, c: n }))} />
      <Stepper label={t('Fat (g)')} value={v.f || 0} step={1} onChange={n => setV(x => ({ ...x, f: n }))} />
    </div>
    {/* Labels round and fibre does not fit 4/4/9, so a small gap is normal — this only speaks
        up when the two numbers have genuinely parted company. */}
    {off && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 8 }}>
      {t('Those macros work out to about {0} kcal, not {1}. Worth a second look.', implied, v.kcal)}
    </div>}
  </>
}

/* ============================ add or edit one item ============================ */
function FoodForm({ existing, prefill, iso, onDone, close }) {
  const start = existing || prefill || {}
  const [n, setN] = useState(start.n || '')
  const [q, setQ] = useState(start.q || '')
  const [v, setV] = useState({ kcal: start.kcal || 0, p: start.p || 0, c: start.c || 0, f: start.f || 0 })
  const ref = useRef(null)
  useEffect(() => { if (!existing && !prefill) setTimeout(() => ref.current?.focus(), 250) }, [])

  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!(v.kcal > 0) && !(v.p > 0) && !(v.c > 0) && !(v.f > 0)) { toast(t('Enter at least one number')); return }
    const src = existing ? existing.src : (start.src || 'manual')
    update(s => {
      if (existing) updateFood(s, existing.id, { n: name, q: q.trim(), ...v })
      else addFood(s, { n: name, q: q.trim(), ...v, src }, iso)
    })
    close()
    toast(existing ? t('Saved') : t('{0} logged', name))
    onDone && onDone()
  }

  return <>
    <h3>{existing ? t('Edit entry') : t('Add food')}</h3>
    {start.src === 'ai' && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10, lineHeight: 1.4 }}>
      <Icon name="sparkles" style={{ fontSize: 12, marginRight: 5 }} />
      {t('An estimate — check the portion before you log it.')}
    </div>}
    <input ref={ref} className="input" placeholder={t('What was it?')} value={n} onChange={e => setN(e.target.value)} />
    <div style={{ height: 8 }} />
    <input className="input" placeholder={t('How much? e.g. 150 g, 1 bowl')} value={q} onChange={e => setQ(e.target.value)} />
    <div style={{ height: 12 }} />
    <MacroFields v={v} setV={setV} />
    <div style={{ height: 6 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Add to today')}</Button>
    {existing && <><div style={{ height: 8 }} />
      <Button variant="danger" icon="trash" onClick={() => {
        update(s => removeFood(s, existing.id)); close(); toast(t('Removed'))
      }}>{t('Remove')}</Button></>}
  </>
}
export const foodFormSheet = opts => ui().openSheet(close => <FoodForm {...opts} close={close} />)

/* ============================ search the free database ============================ */
function FoodSearch({ iso, close }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hits, setHits] = useState(null)
  const abort = useRef(null)

  const go = async () => {
    const term = q.trim()
    if (term.length < 2) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setBusy(true); setErr(''); setHits(null)
    try {
      setHits(await searchFood(term, { signal: ctl.signal }))
    } catch (e) {
      if (e.name !== 'AbortError') setErr(t('Could not reach the food database. Check your connection, or type it in by hand.'))
    } finally { setBusy(false) }
  }
  useEffect(() => () => abort.current?.abort(), [])

  const pick = prod => { close(); foodFormSheet({ iso, prefill: scaleProduct(prod, prod.serving || 100) }) }

  return <>
    <h3>{t('Search food')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {t('Open Food Facts — free and open, no account. Strongest on anything with a barcode.')}
    </div>
    <div className="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('e.g. greek yoghurt')} value={q} autoFocus
        onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) go() }} />
    </div>
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={go} disabled={busy || q.trim().length < 2}>{busy ? t('Searching…') : t('Search')}</Button>
    {err && <div className="small" style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
    {hits && hits.length === 0 && <div className="empty" style={{ marginTop: 12 }}>{t('Nothing found — try fewer words, or add it by hand.')}</div>}
    {hits && hits.length > 0 && <div className="list" style={{ marginTop: 12 }}>
      {hits.map(h => <div key={h.code + h.n} className="item" onClick={() => pick(h)}>
        <div className="grow">
          <div className="tt">{h.n}</div>
          <div className="ss">{[h.brand, t('{0} kcal / 100 g', h.kcal), `P ${fmtNum(h.p)} · C ${fmtNum(h.c)} · F ${fmtNum(h.f)}`].filter(Boolean).join(' · ')}</div>
        </div>
        <Icon name="plus" className="chev" />
      </div>)}
    </div>}
    <div style={{ height: 10 }} />
    <Button icon="pencil" onClick={() => { close(); foodFormSheet({ iso, prefill: { n: q.trim() } }) }}>{t('Add it by hand instead')}</Button>
  </>
}
export const foodSearchSheet = iso => ui().openSheet(close => <FoodSearch iso={iso} close={close} />)

/* ============================ AI: describe it or photograph it ============================ */
function FoodAI({ iso, close }) {
  const [text, setText] = useState('')
  const [img, setImg] = useState(null)         // { b64, url }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const [picked, setPicked] = useState([])
  const fileRef = useRef(null)

  const onFile = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''
    if (!f) return
    setErr('')
    try { setImg({ b64: await shrinkToBase64(f), url: URL.createObjectURL(f) }) }
    catch (e) { setErr(t('Could not read that image')) }
  }

  const go = async () => {
    setBusy(true); setErr(''); setRes(null)
    try {
      const out = await estimateMeal({ text: text.trim(), imageBase64: img?.b64 })
      if (!out.items.length) { setErr(out.note || t('No food found in that.')); return }
      setRes(out); setPicked(out.items.map(() => true))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const logAll = () => {
    const chosen = res.items.filter((_, i) => picked[i])
    if (!chosen.length) return
    update(s => chosen.forEach(it => addFood(s, it, iso)))
    close()
    toast(t(chosen.length === 1 ? '{0} logged' : '{0} items logged', chosen.length === 1 ? chosen[0].n : chosen.length))
  }

  if (!hasKey()) return <>
    <h3>{t('AI estimate')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Describe a meal or photograph it and openGym works out the calories and macros. It runs on your own Anthropic API key — roughly a penny a photo — and it is the only part of the app that talks to anyone else’s server.')}
    </div>
    <Button variant="primary" icon="gear" onClick={() => { close(); aiKeySheet() }}>{t('Set up an API key')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); foodSearchSheet(iso) }}>{t('Search the free database instead')}</Button>
  </>

  return <>
    <h3>{t('AI estimate')}</h3>
    {!res && <>
      <div className="muted small" style={{ marginBottom: 10 }}>{t('Describe the meal, add a photo, or both — both together works best.')}</div>
      <textarea className="input" rows={3} maxLength={400} placeholder={t('e.g. two scrambled eggs on toast with butter')}
        value={text} onChange={e => setText(e.target.value)} />
      <div style={{ height: 10 }} />
      {img
        ? <div className="exmedia" style={{ marginBottom: 10 }}><img src={img.url} alt="" /></div>
        : null}
      <Button icon="camera" onClick={() => fileRef.current?.click()}>{img ? t('Choose a different photo') : t('Add a photo')}</Button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} hidden />
      <div style={{ height: 10 }} />
      <Button variant="primary" icon="sparkles" disabled={busy || (!text.trim() && !img)} onClick={go}>
        {busy ? t('Working it out…') : t('Estimate')}
      </Button>
    </>}
    {err && <div className="small" style={{ color: 'var(--red)', marginTop: 10, lineHeight: 1.4 }}>{err}</div>}
    {res && <>
      <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10, lineHeight: 1.4 }}>
        {t('Estimates. Portion size from a photo is largely inference — tap any row to correct it before logging.')}
      </div>
      <div className="sect-b" style={{ marginBottom: 10 }}>
        {res.items.map((it, i) => <Row key={i}
          title={it.n + (it.confident ? '' : ' ?')}
          subtitle={[it.q, t('{0} kcal', it.kcal), `P ${fmtNum(it.p)} · C ${fmtNum(it.c)} · F ${fmtNum(it.f)}`].filter(Boolean).join(' · ')}>
          <Switch checked={picked[i]} onChange={v => setPicked(x => x.map((y, j) => (j === i ? v : y)))} />
        </Row>)}
      </div>
      {res.note && <div className="small dim" style={{ marginBottom: 10, lineHeight: 1.4 }}>{res.note}</div>}
      <Button variant="primary" icon="plus" disabled={!picked.some(Boolean)} onClick={logAll}>{t('Log these')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => { setRes(null); setErr('') }}>{t('Try again')}</Button>
    </>}
  </>
}
export const foodAiSheet = iso => ui().openSheet(close => <FoodAI iso={iso} close={close} />)

/* ============================ the key ============================ */
function AiKey({ close }) {
  const [k, setK] = useState(getKey())
  const [m, setM] = useState(getModel())
  return <>
    <h3>{t('AI estimates')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t('Paste an Anthropic API key to turn on food estimates from text and photos. Everything else in openGym works without one.')}
    </div>
    <input className="input" type="password" placeholder="sk-ant-…" value={k} onChange={e => setK(e.target.value)} autoComplete="off" />
    <div className="dim small" style={{ margin: '8px 2px 0', lineHeight: 1.45 }}>
      {t('The key is stored on this device only. It is deliberately kept out of your synced profile, your JSON backups and any plan you share — so it never leaves this phone except to call the API.')}
    </div>
    <h4 className="sec">{t('Model')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Model')} sheetTitle={t('Model')} value={m} onChange={setM}
        options={AI_MODELS.map(x => ({ value: x.id, label: x.name, subtitle: t(x.hint) }))} />
    </div>
    <div className="small dim" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('You pay Anthropic directly for what you use. A photo is a small fraction of a cent to about a penny depending on the model.')}
    </div>
    <Button variant="primary" onClick={() => { setKey(k); setModel(m); close(); toast(k.trim() ? t('AI estimates on') : t('AI estimates off')) }}>
      {t('Save')}
    </Button>
    {getKey() && <><div style={{ height: 8 }} />
      <Button variant="danger" icon="trash" onClick={() => { setKey(''); close(); toast(t('Key removed')) }}>{t('Remove the key')}</Button></>}
  </>
}
export const aiKeySheet = () => ui().openSheet(close => <AiKey close={close} />)

/* ============================ daily target ============================ */
function FoodTarget({ close }) {
  const st = useStore(s => s.S)
  const cur = targetOf(st) || {}
  const [v, setV] = useState({ kcal: cur.kcal || 0, p: cur.p || 0, c: cur.c || 0, f: cur.f || 0 })
  const sugg = suggestProtein(st)
  return <>
    <h3>{t('Daily target')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Leave anything at zero to not track it.')}</div>
    <MacroFields v={v} setV={setV} />
    {sugg > 0 && <Button size="sm" icon="lightbulb" style={{ marginBottom: 12 }} onClick={() => setV(x => ({ ...x, p: sugg }))}>
      {t('Suggest protein from body weight ({0} g)', sugg)}
    </Button>}
    <div className="small dim" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('The protein suggestion is 1.6 g per kg of body weight — the low end of what training reviews converge on. openGym has no idea what you are training for, so everything here is yours to set.')}
    </div>
    <Button variant="primary" onClick={() => {
      const any = v.kcal > 0 || MACROS.some(k => v[k] > 0)
      update(s => { s.foodTarget = any ? { ...v } : null })
      close(); toast(any ? t('Target saved') : t('Target removed'))
    }}>{t('Save')}</Button>
    {targetOf(st) && <><div style={{ height: 8 }} />
      <Button variant="danger" onClick={() => { update(s => { s.foodTarget = null }); close(); toast(t('Target removed')) }}>{t('Remove target')}</Button></>}
  </>
}
export const foodTargetSheet = () => ui().openSheet(close => <FoodTarget close={close} />)

/* ============================ how to add ============================ */
// The chooser leads with what you have eaten before, because most food logging is the same
// dozen things on repeat — one tap re-logs an item with the numbers you last corrected.
function AddFood({ iso, close }) {
  const st = useStore(s => s.S)
  const recents = recentFoods(st)
  const relog = r => {
    update(s => addFood(s, { ...r }, iso))
    close()
    toast(t('{0} logged', r.n))
  }
  return <>
    <h3>{t('Add food')}</h3>
    <div className="list">
      <div className="item" onClick={() => { close(); foodSearchSheet(iso) }}>
        <span className="lrow-i"><Icon name="magnifier" /></span>
        <div className="grow"><div className="tt">{t('Search the food database')}</div><div className="ss">{t('Free, no account — best for packaged food')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
      <div className="item" onClick={() => { close(); barcodeSheet(iso) }}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="magnifier" /></span>
        <div className="grow"><div className="tt">{t('Scan a barcode')}</div><div className="ss">{t('Point the camera at the packet')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
      <div className="item" onClick={() => { close(); foodAiSheet(iso) }}>
        <span className="lrow-i" style={{ background: 'var(--acc)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('Describe it or photograph it')}</div><div className="ss">{hasKey() ? t('AI estimate — needs checking before you log it') : t('Needs your own API key')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
      <div className="item" onClick={() => { close(); foodFormSheet({ iso }) }}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="pencil" /></span>
        <div className="grow"><div className="tt">{t('Type it in')}</div><div className="ss">{t('Straight off the packet')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
    {recents.length > 0 && <>
      <h4 className="sec">{t('Log it again')}</h4>
      <div className="list">
        {recents.map((r, i) => <div key={i} className="item" onClick={() => relog(r)}>
          <div className="grow">
            <div className="tt">{r.n}</div>
            <div className="ss">{[r.q, `${r.kcal} kcal`, r.times > 1 ? t('logged {0} times', r.times) : null].filter(Boolean).join(' · ')}</div>
          </div>
          {isEstimate(r) && <span className="tag"><Icon name="sparkles" /></span>}
          <Icon name="plus" className="chev" />
        </div>)}
      </div>
    </>}
  </>
}
export const addFoodSheet = iso => ui().openSheet(close => <AddFood iso={iso} close={close} />)

/* ============================ barcode ============================ */
// Live camera scanning uses the platform's BarcodeDetector where it exists (Chrome, Android
// WebView — i.e. the sideloaded app) and quietly does not where it does not (iOS Safari, at
// the time of writing). The typed fallback is always there, so a barcode is never a dead end
// — the digits under the bars are the same lookup.
function BarcodeScan({ iso, close }) {
  const videoRef = useRef(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const stop = useRef(null)
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const found = async raw => {
    stopCam()
    setBusy(true); setErr('')
    try {
      const prod = await lookupBarcode(raw)
      if (!prod) { setErr(t('{0} is not in the database — add it by hand and it will be a recent next time.', raw)); setBusy(false); return }
      close()
      foodFormSheet({ iso, prefill: scaleProduct(prod, prod.serving || 100) })
    } catch (e) {
      setErr(t('Could not reach the food database. Check your connection, or type it in by hand.'))
      setBusy(false)
    }
  }

  const stopCam = () => {
    if (stop.current) { stop.current(); stop.current = null }
    setScanning(false)
  }

  const startCam = async () => {
    setErr('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      const video = videoRef.current
      video.srcObject = stream
      await video.play()
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
      let live = true
      const tick = async () => {
        if (!live) return
        try {
          const codes = await detector.detect(video)
          if (codes.length && codes[0].rawValue) { found(codes[0].rawValue); return }
        } catch (e) { /* a frame that fails to decode is just the next frame's problem */ }
        setTimeout(tick, 250)
      }
      stop.current = () => { live = false; stream.getTracks().forEach(tr => tr.stop()) }
      setScanning(true)
      tick()
    } catch (e) {
      setErr(t('Could not open the camera — type the digits instead.'))
    }
  }
  // The camera must not outlive the sheet, whatever way the sheet goes.
  useEffect(() => () => stopCam(), [])

  return <>
    <h3>{t('Scan a barcode')}</h3>
    {canScan ? <>
      {scanning
        ? <div className="exmedia" style={{ marginBottom: 10 }}><video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 12 }} /></div>
        : <Button variant="primary" icon="camera" onClick={startCam} disabled={busy}>{t('Open the camera')}</Button>}
      {scanning && <div className="small dim" style={{ margin: '4px 2px 10px' }}>{t('Hold the barcode steady in the frame.')}</div>}
    </> : <div className="small dim" style={{ marginBottom: 10, lineHeight: 1.45 }}>
      {t('This browser cannot scan with the camera — type the digits printed under the bars instead.')}
    </div>}
    <div style={{ height: 8 }} />
    <input className="input" inputMode="numeric" placeholder={t('Barcode digits, e.g. 5000112637922')}
      value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))} />
    <div style={{ height: 10 }} />
    <Button icon="magnifier" disabled={busy || code.length < 6} onClick={() => found(code)}>{busy ? t('Looking it up…') : t('Look it up')}</Button>
    {err && <div className="small" style={{ color: 'var(--yellow)', marginTop: 10, lineHeight: 1.4 }}>{err}</div>}
  </>
}
export const barcodeSheet = iso => ui().openSheet(close => <BarcodeScan iso={iso} close={close} />)
