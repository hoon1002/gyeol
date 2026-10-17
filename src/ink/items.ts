/**
 * 손글씨 엔진 — 쪽 위 물건(DOM): 사진 · 글 상자 · 가리개 테이프 (design-ink 2-9 · 7장).
 * 쪽마다 두 그릇: 아래(사진·글, 형광 밑) · 위(테이프, 잉크 위). 세계 변환 층 안이라 확대·이동은 CSS가 맡는다.
 * 물건의 자리 = 행렬 T(x + w/2, y + h/2) · R(rot) · T(−w/2, −h/2) (transform-origin 0 0).
 */
import type { InkItem } from '@/db/ink'
import { getAssetBlob } from '@/db/ink'
import { mul, type Mat } from './geom'
import { inkColor, tapeColor } from './palette'
import type { InkEngine } from './engine'
import type { PageView } from './render'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function itemMatrix(it: Pick<InkItem, 'x' | 'y' | 'w' | 'h' | 'rot'>): Mat {
  const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0)
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2
  // T(c) R T(-w/2,-h/2)
  return [c, s, -s, c, cx - c * (it.w / 2) + s * (it.h / 2), cy - s * (it.w / 2) - c * (it.h / 2)]
}

const css = (m: Mat) => `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})`

/** id 해시로 조금씩 다른 찢긴 끝 (진폭 1.2pt, 주기 3.5pt) */
export function tapePath(id: string, w: number, h: number): string {
  let seed = 2166136261
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619)
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0) / 4294967296)
  const amp = 1.2, per = 3.5
  const n = Math.max(2, Math.round(h / (per / 2)))
  const pts: string[] = []
  pts.push(`M${amp},0`, `L${w - amp},0`)
  for (let i = 1; i <= n; i++) {
    const y = (i / n) * h
    const x = w - (i % 2 ? 0 : amp * 2) * (0.6 + rnd() * 0.4) - (i % 2 ? rnd() * 0.3 : 0)
    pts.push(`L${x.toFixed(2)},${y.toFixed(2)}`)
  }
  pts.push(`L${amp},${h}`)
  for (let i = n - 1; i >= 0; i--) {
    const y = (i / n) * h
    const x = (i % 2 ? 0 : amp * 2) * (0.6 + rnd() * 0.4) + (i % 2 ? rnd() * 0.3 : 0)
    pts.push(`L${x.toFixed(2)},${y.toFixed(2)}`)
  }
  pts.push('Z')
  return pts.join('')
}

interface PageBox {
  under: HTMLDivElement
  over: HTMLDivElement
  els: Map<string, HTMLElement>
}

export class ItemsLayer {
  private pages = new Map<string, PageBox>()
  private urls = new Map<string, string>()
  private loadingUrls = new Map<string, Promise<string | null>>()
  editing: { pageId: string; id: string; ta: HTMLTextAreaElement; isNew: boolean; before: InkItem } | null = null

  constructor(
    private eng: InkEngine,
    private underL: HTMLDivElement,
    private overL: HTMLDivElement,
  ) {}

  attach(pv: PageView): void {
    if (this.pages.has(pv.pm.id)) return
    const under = document.createElement('div')
    under.className = 'ink-items'
    const over = document.createElement('div')
    over.className = 'ink-items ink-items-over'
    this.underL.appendChild(under)
    this.overL.appendChild(over)
    this.pages.set(pv.pm.id, { under, over, els: new Map() })
    this.place(pv)
    if (pv.pm.state === 'ready') this.sync(pv)
  }

  detach(pv: PageView): void {
    const p = this.pages.get(pv.pm.id)
    if (!p) return
    p.under.remove()
    p.over.remove()
    this.pages.delete(pv.pm.id)
  }

  place(pv: PageView): void {
    const p = this.pages.get(pv.pm.id)
    if (!p) return
    const { x, y, w, h } = pv.box
    const r = this.eng.view.spec.radius / this.eng.view.fit
    for (const el of [p.under, p.over]) {
      el.style.transform = `translate(${x}px, ${y}px)`
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      el.style.borderRadius = r + 'px'
    }
  }

  /** 쪽 물건을 DOM에 맞춘다 */
  sync(pv: PageView): void {
    const p = this.pages.get(pv.pm.id)
    if (!p) return
    const want = pv.pm.itemsSorted()
    const ids = new Set(want.map((i) => i.id))
    for (const [id, el] of p.els)
      if (!ids.has(id)) {
        el.remove()
        p.els.delete(id)
      }
    const dark = pv.spec.dark
    want.forEach((it, z) => {
      let el = p.els.get(it.id)
      const host = it.kind === 'tape' ? p.over : p.under
      if (!el || el.dataset.kind !== it.kind) {
        el?.remove()
        el = this.create(it)
        p.els.set(it.id, el)
      }
      if (el.parentElement !== host) host.appendChild(el)
      el.style.zIndex = String(z + 1)
      this.update(el, it, dark)
    })
  }

  private create(it: InkItem): HTMLElement {
    const el = document.createElement('div')
    el.dataset.kind = it.kind
    el.dataset.id = it.id
    if (it.kind === 'image') {
      el.className = 'ink-img'
      const img = document.createElement('img')
      img.alt = ''
      img.draggable = false
      img.decoding = 'async'
      el.appendChild(img)
    } else if (it.kind === 'text') {
      el.className = 'ink-text'
    } else {
      el.className = 'ink-tape'
      el.innerHTML =
        '<svg class="ink-tape-line" aria-hidden="true"><path/></svg>' +
        '<div class="ink-tape-face"><svg aria-hidden="true"><defs><pattern patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(-35)"><rect width="1" height="5"/></pattern></defs><path class="f"/><path class="t"/></svg><i class="ink-tape-flag"></i></div>' +
        '<i class="ink-tape-lift"></i>'
    }
    return el
  }

  private update(el: HTMLElement, it: InkItem, dark: boolean): void {
    const st = el.style
    st.transform = css(itemMatrix(it))
    if (it.kind === 'image') {
      st.width = it.w + 'px'
      st.height = it.h + 'px'
      const img = el.firstElementChild as HTMLImageElement
      const id = it.assetId
      if (id && img.dataset.asset !== id) {
        img.dataset.asset = id
        void this.url(id).then((u) => {
          if (u && img.dataset.asset === id) img.src = u
        })
      }
    } else if (it.kind === 'text') {
      const fs = it.fontSize ?? 12
      st.fontSize = fs + 'px'
      st.maxWidth = it.w + 'px'
      st.minHeight = fs * 1.5 + 'px'
      st.color = inkColor(it.color ?? '#1B1D22', dark)
      if (el.textContent !== (it.text ?? '')) el.textContent = it.text ?? ''
      el.classList.toggle('is-editing', this.editing?.id === it.id)
    } else {
      st.width = it.w + 'px'
      st.height = it.h + 'px'
      const color = tapeColor(it.color, dark)
      const key = `${it.w}|${it.h}`
      const svgs = el.querySelectorAll('svg')
      const line = svgs[0]!, face = svgs[1]!
      if (el.dataset.size !== key) {
        el.dataset.size = key
        const d = tapePath(it.id, it.w, it.h)
        for (const s of [line, face]) {
          s.setAttribute('viewBox', `0 0 ${it.w} ${it.h}`)
          s.setAttribute('width', String(it.w))
          s.setAttribute('height', String(it.h))
        }
        line.querySelector('path')!.setAttribute('d', d)
        face.querySelectorAll('path').forEach((p) => p.setAttribute('d', d))
        const pat = face.querySelector('pattern')!
        const pid = 'tf' + it.id
        pat.id = pid
        face.querySelector('path.t')!.setAttribute('fill', `url(#${pid})`)
      }
      st.setProperty('--tape', color)
      el.dataset.dark = dark ? '1' : '0'
      face.querySelector('path.f')!.setAttribute('fill', color)
      face.querySelector('rect')!.setAttribute('fill', dark ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.035)')
      const state = it.hidden ? 'covered' : 'revealed'
      if (el.dataset.state !== state && !el.dataset.anim) el.dataset.state = state
      el.classList.toggle('is-flag', !!it.flag)
    }
  }

  /** 끄는 동안 고른 물건에 임시 행렬 */
  setDrag(pageId: string, ids: Iterable<string>, m: Mat | null): void {
    const p = this.pages.get(pageId)
    const pm = this.eng.doc.byId.get(pageId)
    if (!p || !pm) return
    for (const id of ids) {
      const el = p.els.get(id)
      const it = pm.items.get(id)
      if (!el || !it) continue
      el.style.transform = css(m ? mul(m, itemMatrix(it)) : itemMatrix(it))
    }
  }

  /** 글 상자 실제 크기 (DOM 잰 값, pt) */
  measure(pageId: string, id: string): { w: number; h: number } | null {
    const el = this.pages.get(pageId)?.els.get(id)
    if (!el) return null
    return { w: el.offsetWidth, h: el.offsetHeight }
  }

  /* ---------- 테이프 걷기 · 붙이기 (7-3) ---------- */

  animateTape(pageId: string, it: InkItem, toHidden: boolean, fromStart: boolean, at: [number, number] | null, delay = 0, dur?: number): void {
    const el = this.pages.get(pageId)?.els.get(it.id)
    if (!el) return
    const face = el.querySelector<HTMLElement>('.ink-tape-face')!
    const lift = el.querySelector<HTMLElement>('.ink-tape-lift')!
    const d = dur ?? (toHidden ? 180 : 260)
    el.dataset.anim = '1'
    const done = () => {
      delete el.dataset.anim
      el.dataset.state = toHidden ? 'covered' : 'revealed'
      face.style.transition = face.style.clipPath = ''
      lift.style.transition = lift.style.transform = lift.style.opacity = ''
    }
    if (reduced()) {
      el.dataset.state = toHidden ? 'covered' : 'revealed'
      el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 120, delay })
      delete el.dataset.anim
      return
    }
    const ease = toHidden ? 'cubic-bezier(.65,0,.35,1)' : 'cubic-bezier(.22,1,.36,1)'
    // 시작 모양
    el.dataset.state = 'anim'
    const openFrom = fromStart ? 'inset(0 0 0 0)' : 'inset(0 0 0 0)'
    const shut = fromStart ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)'
    const startClip = toHidden ? (fromStart ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)') : openFrom
    const endClip = toHidden ? 'inset(0 0 0 0)' : shut
    face.style.transition = 'none'
    face.style.clipPath = startClip
    const w = it.w
    lift.style.transition = 'none'
    lift.style.opacity = toHidden ? '0' : '1'
    lift.style.transform = `translateX(${fromStart ? 0 : w - 4}px)`
    void face.offsetWidth
    setTimeout(() => {
      face.style.transition = `clip-path ${d}ms ${ease}`
      face.style.clipPath = endClip
      if (!toHidden) {
        lift.style.transition = `transform ${d}ms ${ease}, opacity 80ms ${d - 60}ms`
        lift.style.transform = `translateX(${fromStart ? w - 4 : 0}px)`
        lift.style.opacity = '0'
      }
    }, delay)
    setTimeout(done, delay + d + 20)
    if (!toHidden && at) this.sparkle(pageId, it, at, delay + Math.round(d * 0.2))
  }

  /** 별빛 점 3개 (K3) — 하늘은 깨우지 않는다(종이 층) */
  private sparkle(pageId: string, it: InkItem, at: [number, number], delay: number): void {
    const p = this.pages.get(pageId)
    if (!p) return
    const s = this.eng.view.s
    let h = 0
    for (let i = 0; i < it.id.length; i++) h = (h * 31 + it.id.charCodeAt(i)) | 0
    const color = this.eng.night ? '#F3D29A' : '#7A5714'
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('i')
      dot.className = 'ink-spark'
      const a = ((h >>> (i * 5)) % 360) * (Math.PI / 180) + (i * Math.PI * 2) / 3
      const dist = (6 + ((h >>> (i * 3)) % 5)) / s
      dot.style.cssText = `left:${at[0]}px;top:${at[1]}px;width:${1.5 / s}px;height:${1.5 / s}px;background:${color}`
      p.over.appendChild(dot)
      dot.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * dist}px), calc(-50% + ${Math.sin(a) * dist}px))`, opacity: 0 }], {
        duration: 400,
        delay,
        easing: 'cubic-bezier(.22,1,.36,1)',
        fill: 'both',
      }).onfinish = () => dot.remove()
    }
  }

  /** 지워지는 · 되살아나는 획 대신 물건 페이드 (되돌리기 모션) */
  fade(pageId: string, id: string, inOut: 'in' | 'out', ms = 120): void {
    const el = this.pages.get(pageId)?.els.get(id)
    if (!el || reduced()) return
    el.animate(inOut === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: ms })
  }

  /* ---------- 글 상자 편집 ---------- */

  startEdit(pageId: string, it: InkItem, isNew: boolean): HTMLTextAreaElement | null {
    this.finishEdit()
    const p = this.pages.get(pageId)
    if (!p) return null
    const ta = document.createElement('textarea')
    ta.className = 'ink-text-edit'
    ta.value = it.text ?? ''
    ta.spellcheck = false
    ta.setAttribute('autocapitalize', 'off')
    ta.setAttribute('aria-label', '글 상자')
    const fs = it.fontSize ?? 12
    const dark = this.eng.r.views.get(pageId)?.spec.dark ?? this.eng.night
    ta.style.cssText = `transform:${css(itemMatrix(it))};font-size:${fs}px;width:${it.w}px;min-height:${fs * 1.5}px;color:${inkColor(it.color ?? '#1B1D22', dark)}`
    p.under.appendChild(ta)
    const fit = () => {
      ta.style.height = '0px'
      ta.style.height = ta.scrollHeight + 'px'
    }
    fit()
    ta.addEventListener('input', fit)
    let composing = false
    ta.addEventListener('compositionstart', () => (composing = true))
    ta.addEventListener('compositionend', () => (composing = false))
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing || composing || e.keyCode === 229) return
      if (e.key === 'Escape') {
        e.preventDefault()
        ta.blur()
      }
      e.stopPropagation()
    })
    ta.addEventListener('blur', () => this.eng.endTextEdit())
    this.editing = { pageId, id: it.id, ta, isNew, before: it }
    p.els.get(it.id)?.classList.add('is-editing')
    ta.focus({ preventScroll: true })
    return ta
  }

  finishEdit(): { pageId: string; id: string; text: string; isNew: boolean; before: InkItem; h: number } | null {
    const e = this.editing
    if (!e) return null
    this.editing = null
    const text = e.ta.value
    const h = e.ta.offsetHeight
    e.ta.remove()
    this.pages.get(e.pageId)?.els.get(e.id)?.classList.remove('is-editing')
    return { pageId: e.pageId, id: e.id, text, isNew: e.isNew, before: e.before, h }
  }

  /* ---------- 첨부 URL ---------- */

  url(assetId: string): Promise<string | null> {
    const hit = this.urls.get(assetId)
    if (hit) return Promise.resolve(hit)
    let p = this.loadingUrls.get(assetId)
    if (!p) {
      p = getAssetBlob(this.eng.db, assetId).then((b) => {
        this.loadingUrls.delete(assetId)
        if (!b) return null
        const u = URL.createObjectURL(b)
        this.urls.set(assetId, u)
        return u
      })
      this.loadingUrls.set(assetId, p)
    }
    return p
  }

  destroy(): void {
    this.finishEdit()
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
    for (const p of this.pages.values()) {
      p.under.remove()
      p.over.remove()
    }
    this.pages.clear()
  }
}
