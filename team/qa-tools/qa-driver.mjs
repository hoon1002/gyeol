// QA CDP 드라이버: 헤드리스 크롬 페이지 하나에 세션을 붙잡고, 127.0.0.1:CTRL_PORT로 POST한 시나리오(JS 본문)를 돌린다.
// 쓰기: team/qa-tools/qa-launch.sh & → node team/qa-tools/qa-driver.mjs & → curl -s --data-binary @team/qa-tools/scenarios/qa-….js 127.0.0.1:9387
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
// 자기 크롬에만 붙는다: 자기 프로필의 DevToolsActivePort 첫 줄 = 포트
const CDP = +fs.readFileSync(path.join(ROOT, 'team/.qa-profile/DevToolsActivePort'), 'utf8').split('\n')[0]
const CTRL = +(process.env.CTRL_PORT || 9387)
const SHOTS = path.join(ROOT, 'team/figma-assets/qa')
const LOGF = path.join(HERE, 'out/console.log')
fs.mkdirSync(SHOTS, { recursive: true })
fs.mkdirSync(path.dirname(LOGF), { recursive: true })

let ws
let seq = 0
const pending = new Map()
const subs = new Map()
const cbuf = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, { res, rej, method })
    setTimeout(() => pending.has(id) && (pending.delete(id), rej(new Error('timeout ' + method))), 30000)
  })
}
const on = (m, fn) => {
  if (!subs.has(m)) subs.set(m, new Set())
  subs.get(m).add(fn)
  return () => subs.get(m).delete(fn)
}
const log = (type, text, f) => {
  const e = { t: new Date().toISOString().slice(11, 23), type, text: String(text).slice(0, 600), at: f ? `${(f.url || '').split('/').slice(-2).join('/')}:${f.lineNumber}` : '' }
  cbuf.push(e)
  fs.appendFileSync(LOGF, JSON.stringify(e) + '\n')
}

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.rej(new Error(p.method + ': ' + msg.error.message)) : p.res(msg.result)
    } else if (msg.method) subs.get(msg.method)?.forEach((fn) => fn(msg.params))
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')
  on('Runtime.consoleAPICalled', (p) => ['error', 'warning', 'assert'].includes(p.type) && log(p.type, p.args.map((a) => a.value ?? a.description ?? a.type).join(' '), p.stackTrace?.callFrames?.[0]))
  on('Runtime.exceptionThrown', (p) => log('exception', p.exceptionDetails.exception?.description ?? p.exceptionDetails.text, p.exceptionDetails.stackTrace?.callFrames?.[0]))
  on('Log.entryAdded', (p) => ['error', 'warning'].includes(p.entry.level) && log('log.' + p.entry.level, p.entry.text + (p.entry.url ? ' ' + p.entry.url : '')))
}

/* ---------- 도구 ---------- */
let mode = 'mouse' // 'mouse' | 'touch' | 'pen'
let btns = 0
let vp = { w: 1440, h: 900 }
const api = {
  sleep,
  send,
  on,
  logs: (clear = true) => (clear ? cbuf.splice(0) : cbuf.slice()),
  get mode() { return mode },
  setMode: (m) => (mode = m),
  vp: () => vp,
  async ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  },
  async size(w, h, { touch = false, mobile = touch && Math.min(w, h) < 600, dpr = 1 } = {}) {
    vp = { w, h }
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile, screenWidth: w, screenHeight: h, screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } })
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, ...(touch ? { maxTouchPoints: 5 } : {}) })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: touch ? 'coarse' : 'fine' }, { name: 'hover', value: touch ? 'none' : 'hover' }] }).catch(() => {})
  },
  async nav(url, wait = 1800) {
    const loaded = new Promise((res) => { const off = on('Page.loadEventFired', () => (off(), res())) })
    await send('Page.navigate', { url: url.startsWith('http') ? url : 'http://localhost:5173' + url })
    await Promise.race([loaded, sleep(15000)])
    await send('Page.bringToFront').catch(() => {})
    await sleep(wait)
  },
  async shot(name, o = {}) {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: o.q ?? 60, ...(o.clip ? { clip: { ...o.clip, scale: o.scale ?? 1 } } : {}) })
    const f = path.join(SHOTS, name.replace(/\.jpg$/, '') + '.jpg')
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    return path.relative(ROOT, f)
  },
  /* 마우스 · 펜 (CDP 마우스 이벤트 + pointerType) */
  async m(type, x, y, o = {}) {
    const p = { type, x, y, button: type === 'mouseMoved' ? (btns ? 'left' : 'none') : 'left', buttons: btns, clickCount: type === 'mouseMoved' ? 0 : o.clickCount ?? 1, modifiers: o.mods ?? 0, pointerType: o.pt ?? (mode === 'pen' ? 'pen' : 'mouse') }
    if (p.pointerType === 'pen') Object.assign(p, { force: o.force ?? (btns ? 0.5 : 0), tiltX: o.tiltX ?? 10, tiltY: o.tiltY ?? 5 })
    if (type === 'mouseWheel') Object.assign(p, { deltaX: o.dx ?? 0, deltaY: o.dy ?? 0, button: 'none' })
    await send('Input.dispatchMouseEvent', p)
  },
  /* 터치 */
  async t(type, pts) {
    await send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i, radiusX: 6, radiusY: 6, force: 1 })) })
  },
  async down(x, y, o = {}) {
    if (mode === 'touch') return api.t('touchStart', [[x, y]])
    await api.m('mouseMoved', x, y, o)
    btns = 1
    await api.m('mousePressed', x, y, o)
  },
  async move(x, y, o = {}) {
    if (mode === 'touch') return btns || o.force !== undefined ? api.t('touchMove', [[x, y]]) : api.t('touchMove', [[x, y]])
    await api.m('mouseMoved', x, y, o)
  },
  async up(x, y, o = {}) {
    if (mode === 'touch') return api.t('touchEnd', [])
    btns = 0
    await api.m('mouseReleased', x, y, o)
  },
  /** 누르기(탭/클릭) */
  async tap(x, y, o = {}) {
    await api.down(x, y, o)
    await sleep(o.hold ?? 60)
    await api.up(x, y, o)
    await sleep(o.after ?? 120)
  },
  async dbl(x, y) {
    if (mode === 'touch') { await api.tap(x, y, { after: 60 }); return api.tap(x, y) }
    await api.m('mousePressed', x, y, { clickCount: 1 }); await api.m('mouseReleased', x, y, { clickCount: 1 })
    await api.m('mousePressed', x, y, { clickCount: 2 }); await api.m('mouseReleased', x, y, { clickCount: 2 })
  },
  /** 끌기: (x1,y1) → (x2,y2) steps번, hold = 누른 뒤 멈춤, rest = 놓기 전 멈춤 */
  async drag(x1, y1, x2, y2, o = {}) {
    const n = o.steps ?? 12
    await api.down(x1, y1, o)
    if (o.hold) await sleep(o.hold)
    if (mode === 'touch') btns = 1
    for (let i = 1; i <= n; i++) {
      await api.move(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, o)
      await sleep(o.stepMs ?? 16)
    }
    if (o.rest) await sleep(o.rest)
    await api.up(x2, y2, o)
    if (mode === 'touch') btns = 0
    await sleep(o.after ?? 150)
  },
  /** 두 손가락 벌리기/모으기 (가로로 d0 → d1 px) */
  async pinch(cx, cy, d0, d1, o = {}) {
    const n = o.steps ?? 10
    await api.t('touchStart', [[cx - d0 / 2, cy, 0], [cx + d0 / 2, cy, 1]])
    for (let i = 1; i <= n; i++) {
      const d = d0 + ((d1 - d0) * i) / n
      await api.t('touchMove', [[cx - d / 2, cy, 0], [cx + d / 2, cy, 1]])
      await sleep(16)
    }
    await api.t('touchEnd', [])
    await sleep(o.after ?? 150)
  },
  async wheel(x, y, dy, n = 1) {
    for (let i = 0; i < n; i++) { await api.m('mouseWheel', x, y, { dy }); await sleep(16) }
  },
  /* 키보드: mods 1=Alt 2=Ctrl 4=Meta 8=Shift */
  async key(k, mods = 0) {
    const SP = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Delete: 46, Home: 36, End: 35, ' ': 32 }
    const one = k.length === 1
    const vk = SP[k] ?? (one ? k.toUpperCase().charCodeAt(0) : 0)
    const code = k === ' ' ? 'Space' : one ? (/[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : /\d/.test(k) ? 'Digit' + k : k === '/' ? 'Slash' : '') : k
    const text = mods & 6 ? undefined : one ? (mods & 8 ? k.toUpperCase() : k) : k === 'Enter' ? '\r' : undefined
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: one && mods & 8 ? k.toUpperCase() : k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods, text, unmodifiedText: text })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods })
    await sleep(40)
  },
  async type(s, ms = 20) {
    for (const ch of s) { ch === '\n' ? await api.key('Enter') : await api.key(ch); if (ms) await sleep(ms) }
  },
  insert: (text) => send('Input.insertText', { text }),
  ime: (text) => send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length }),
  /** 상태 한 줄: 경로 · 포커스 · 열린 층 · 별 패널 */
  async st() {
    return api.ev(`(() => {
      const d = (el) => el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + (el.getAttribute && el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '') : null
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && !e.closest('[inert]') }
      const layers = [...document.querySelectorAll('[role=dialog],[aria-modal],.sheet-layer,.palette,.star-info,[class*=memo],[class*=dust],[class*=popover],[class*=suggest],[role=listbox],[role=menu]')].filter(vis).map(d).slice(0, 8)
      return { path: location.pathname + location.search, focus: d(document.activeElement), star: document.documentElement.dataset.starOpen || null, layers }
    })()`)
  },
  /** 화면에 보이는 요소 찾기: [{sel, text, x, y, w, h}] */
  async find(sel, textRe) {
    return api.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 40), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]') } }).filter(o => o.vis${textRe ? ` && new RegExp(${JSON.stringify(textRe)}).test(o.t)` : ''})`)
  },
  async tapSel(sel, textRe, o) {
    const [e] = await api.find(sel, textRe)
    if (!e) throw new Error('없음: ' + sel + ' ' + (textRe || ''))
    await api.tap(e.x, e.y, o)
    return e
  },
  /** 엔진(FieldContext 값)을 React 파이버에서 찾아 window.__qaEng로 둔다 → 보이는 데이터 별 화면 좌표 목록 */
  async stars(step = 50, r = 40) {
    return api.ev(`(() => {
      if (!window.__qaEng) {
        const el = document.querySelector('#root *')
        if (!el) return []
        const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
        let f = k && el[k]
        while (f) { const v = f.memoizedProps && f.memoizedProps.value; if (v && typeof v.pick === 'function' && typeof v.flyTo === 'function') { window.__qaEng = v; break } f = f.return }
      }
      const E = window.__qaEng; if (!E) return 'no-engine'
      const seen = new Map()
      for (let y = 40; y < innerHeight - 40; y += ${step}) for (let x = 40; x < innerWidth - 40; x += ${step}) {
        const h = E.pick(x, y, ${r}); if (h && !seen.has(h.id)) seen.set(h.id, { id: h.id.slice(0, 10), layer: h.layer, x: Math.round(h.screen[0]), y: Math.round(h.screen[1]) })
      }
      return [...seen.values()]
    })()`)
  },
}

await connect()
// 크롬이 스스로 여는 chrome:// 탭(업데이트 안내 등)이 앞에 오면 페이지가 hidden이 되어 하늘이 멈춘다 → 닫고 앞으로
setInterval(async () => {
  try {
    const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()
    const bad = l.filter((t) => t.type === 'page' && t.url.startsWith('chrome://'))
    for (const t of bad) await fetch(`http://127.0.0.1:${CDP}/json/close/${t.id}`)
    if (bad.length) await send('Page.bringToFront')
  } catch {}
}, 700)
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
http
  .createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    const out = []
    const print = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
    try {
      const fn = new AsyncFunction('api', 'print', `with (api) { ${body} }`)
      const ret = await fn(api, print)
      if (ret !== undefined) print(ret)
    } catch (e) {
      out.push('ERR ' + (e && e.message))
    }
    res.end(out.join('\n') + '\n')
  })
  .listen(CTRL, '127.0.0.1', () => console.log('driver ready', CTRL))
