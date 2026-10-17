/**
 * 결 3D 은하 시제품 — 엔진(engine.ts) 위의 얇은 데모. http://127.0.0.1:5173/galaxy3d.html
 * 쿼리: ?tier=A|B|C · ?rot=on|slow|off · ?place=today|… · ?clean=1(UI 숨김) · ?hud=0 · ?lowpower=1 · ?ring=1
 * 측정·렌더: window.__g3d (measure · force · idle · uncap · skip · rs · drag · capture …)
 */
import { Galaxy3D, PLACES, type PlaceId, type Rot, type Tier } from './engine'

const qs = new URLSearchParams(location.search)
const $ = (id: string) => document.getElementById(id)!
const canvas = $('cv') as HTMLCanvasElement
if (qs.get('clean') === '1') document.body.classList.add('clean')
const hudEl = $('hud')
if (qs.get('hud') === '0') hudEl.style.display = 'none'

let gRef: Galaxy3D | null = null
const g = new Galaxy3D({
  query: location.search,
  maskEls: () => ['title', 'ui', 'hud'].map((id) => $(id)),
  ring: { svg: $('ring') as unknown as SVGSVGElement, circle: $('ringC'), arc: $('ringA') },
  onHud: (t) => (hudEl.textContent = t),
  onPlace: (id) => {
    const p = PLACES.find((x) => x.id === id)!
    $('place').textContent = p.name
    $('placeSub').textContent = p.sub
    updateButtons()
  },
  onState: () => updateButtons(),
  onClean: (on) => document.body.classList.toggle('clean', on),
}).mount(canvas)
gRef = g

/* ---------- UI ---------- */
const ui = $('ui')
const btns = new Map<string, HTMLButtonElement>()
function btn(label: string, key: string, on: () => void) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.onclick = on
  ui.appendChild(b)
  btns.set(key, b)
}
const sep = () => ui.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }))
PLACES.forEach((p) => btn(p.name, 'p:' + p.id, () => g.setPlace(p.id as PlaceId)))
btn('처음 자리로', 'home', () => g.raw?.home())
btn('타이머 링', 'ring', () => g.raw?.setRing(!g.raw.state().ringOn))
sep()
;(['on', 'slow', 'off'] as Rot[]).forEach((r) => btn({ on: '회전 켬', slow: '느리게', off: '끔' }[r], 'r:' + r, () => g.setRotation(r)))
sep()
;(['A', 'B', 'C'] as Tier[]).forEach((t) => btn('등급 ' + t, 't:' + t, () => g.raw?.setTier(t)))
function updateButtons() {
  const s = gRef?.raw?.state()
  if (!s) return
  btns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === 'p:' + s.place || k === 'r:' + s.userRot || k === 't:' + s.tier || (k === 'ring' && s.ringOn))))
}
updateButtons()

/* ---------- 검증 · 측정 · 렌더용 ---------- */
const SAVE = 'http://127.0.0.1:5199/save' // 로컬 전용 렌더 저장 도우미(작업용 스크립트, 앱에는 없음)
const dbg = g.debug!
;(window as unknown as { __g3d: unknown }).__g3d = {
  ...dbg,
  api: g.raw,
  /** 가상 화면 렌더(w×h CSS · DPR 2) → PNG를 로컬 저장 도우미로 보낸다 */
  capture: async (name: string, w: number, h: number, setup?: Parameters<typeof dbg.capture>[3]) => {
    const r = await dbg.capture(name, w, h, setup)
    let saved = 'no-server'
    try {
      const res = await fetch(`${SAVE}?name=${encodeURIComponent(name)}`, { method: 'POST', body: r.blob })
      saved = await res.text()
    } catch {
      saved = 'no-server'
    }
    return { saved, bytes: r.bytes, fg: r.fg }
  },
}
