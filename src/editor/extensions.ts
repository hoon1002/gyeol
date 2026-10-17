/**
 * 편집기 확장 (design-m2 3·4장). 지연 로드 청크 안에서만 쓴다.
 *  - NoteLink: [[링크]] 인라인 원자 노드 attrs { to, title }. `[[제목]]`을 다 치면 입력 규칙으로 바뀐다.
 *  - LinkDecor: 링크 글자 모양(있는 노트 = 과목색 밑줄, 없는 노트 = 점선)을 노드 장식으로. 해석기는 바깥에서 준다.
 *  - Trigger: `[[` 제안 · 빈 줄 맨 앞 `/` 메뉴의 상태를 알린다. 장식(decoration)을 쓰지 않으므로 조합 중 DOM을 건드리지 않고,
 *    조합 중에는 다시 평가하지 않으며(view.composing), compositionend 뒤에 한 번 다시 본다.
 *  - Asset: 사진 블록(별가루 사진 메모를 노트로 옮길 때). 사용자가 직접 넣는 블록은 아니다.
 */
import { Extension, InputRule, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { db } from '@/db/schema'

/* ---------- [[링크]] ---------- */

export interface LinkAttrs {
  to: string | null
  title: string
}

export interface NoteLinkOptions {
  /** 링크 글자를 누르면 */
  onOpen: (a: LinkAttrs) => void
}

export const NoteLink = Node.create<NoteLinkOptions>({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { onOpen: () => {} }
  },

  addAttributes() {
    return {
      to: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-to') || null,
        renderHTML: (a) => (a.to ? { 'data-to': a.to } : {}),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') ?? el.textContent ?? '',
        renderHTML: (a) => ({ 'data-title': a.title }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-note-link]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-note-link': '', class: 'nl', href: '#', draggable: 'false' }), String(node.attrs.title ?? '')]
  },

  renderText({ node }) {
    return String(node.attrs.title ?? '')
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^[\]\n]{1,80})\]\]$/,
        handler: ({ state, range, match }) => {
          const title = (match[1] ?? '').trim()
          if (!title) return null
          state.tr.replaceWith(range.from, range.to, this.type.create({ title, to: null }))
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const open = (a: LinkAttrs) => this.options.onOpen(a)
    return [
      new Plugin({
        key: new PluginKey('noteLinkClick'),
        props: {
          handleClickOn: (_view, _pos, node, _nodePos, event) => {
            if (node.type.name !== 'noteLink') return false
            event.preventDefault()
            open({ to: (node.attrs.to as string | null) ?? null, title: String(node.attrs.title ?? '') })
            return true
          },
          handleDOMEvents: {
            click: (_view, e) => {
              if ((e.target as HTMLElement | null)?.closest?.('a[data-note-link]')) e.preventDefault()
              return false
            },
          },
        },
      }),
    ]
  },
})

/* ---------- 링크 글자 모양 ---------- */

export type LinkResolver = (a: LinkAttrs) => { id: string; color: string | null } | null

export const linkDecorKey = new PluginKey<DecorationSet>('noteLinkDecor')

export const LinkDecor = Extension.create<{ resolve: () => LinkResolver }>({
  name: 'noteLinkDecor',
  addOptions() {
    return { resolve: () => () => null }
  },
  addProseMirrorPlugins() {
    const getResolve = this.options.resolve
    const build = (state: EditorState) => {
      const resolve = getResolve()
      const decos: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'noteLink') return
        const hit = resolve({ to: (node.attrs.to as string | null) ?? null, title: String(node.attrs.title ?? '') })
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, hit ? { class: 'nl is-on', style: `--lc:${hit.color ?? 'var(--accent)'}` } : { class: 'nl is-missing' }),
        )
      })
      return DecorationSet.create(state.doc, decos)
    }
    return [
      new Plugin<DecorationSet>({
        key: linkDecorKey,
        state: {
          init: (_c, state) => build(state),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(linkDecorKey) ? build(state) : old),
        },
        props: {
          decorations: (state) => linkDecorKey.getState(state),
        },
      }),
    ]
  },
})

/** 해석기가 바뀌었을 때(노트가 생기거나 지워짐) 장식 다시 그리기 */
export function refreshLinkDecor(view: EditorView): void {
  if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(linkDecorKey, true).setMeta('addToHistory', false))
}

/* ---------- `[[` · `/` 알림 ---------- */

export interface TriggerState {
  kind: 'link' | 'slash'
  /** 지울 범위(`[[` 또는 `/`부터 커서까지) */
  from: number
  to: number
  query: string
}

export interface TriggerOptions {
  onChange: (s: TriggerState | null) => void
  /** 열려 있을 때 ↑↓ Enter Tab. 처리했으면 true */
  onKey: (e: KeyboardEvent) => boolean
}

/** 밖에서 제안 상자 닫기(겹침 층 관리자의 Esc): 그 자리의 `[[`·`/`는 남기고 다시 열지 않는다.
 *  편집기 DOM에 이 이벤트를 보내면 지금 살아 있는 편집기의 플러그인이 받는다(StrictMode로 편집기가 두 번 만들어져도 안전). */
export const TRIGGER_DISMISS = 'gyeol-trigger-dismiss'
export function dismissTrigger(dom: Element | null | undefined): void {
  dom?.dispatchEvent(new Event(TRIGGER_DISMISS))
}

const OBJ = '￼'

export function detectTrigger(state: EditorState): TriggerState | null {
  const sel = state.selection
  if (!sel.empty) return null
  const $from = sel.$from
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.spec.code) return null
  if ($from.marks().some((m) => m.type.spec.code)) return null
  const before = parent.textBetween(0, $from.parentOffset, undefined, OBJ)
  const i = before.lastIndexOf('[[')
  if (i >= 0) {
    const q = before.slice(i + 2)
    if (!q.includes(']]') && !q.includes(OBJ) && !q.includes('\n') && q.length <= 60) return { kind: 'link', from: $from.start() + i, to: $from.pos, query: q }
  }
  if (parent.type.name === 'paragraph') {
    const all = parent.textBetween(0, parent.content.size, undefined, OBJ)
    if (before === all && /^\/[^\s/]{0,20}$/.test(all)) return { kind: 'slash', from: $from.start(), to: $from.pos, query: all.slice(1) }
  }
  return null
}

const same = (a: TriggerState | null, b: TriggerState | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.from === b.from && a.to === b.to && a.query === b.query)

export const Trigger = Extension.create<TriggerOptions>({
  name: 'gyeolTrigger',
  addOptions() {
    return { onChange: () => {}, onKey: () => false }
  },
  addProseMirrorPlugins() {
    const opts = this.options
    let current: TriggerState | null = null
    let dismissed: number | null = null
    const set = (s: TriggerState | null) => {
      if (same(s, current)) return
      current = s
      opts.onChange(s)
    }

    const evaluate = (view: EditorView) => {
      if (view.composing || view.isDestroyed) return
      const next = view.hasFocus() ? detectTrigger(view.state) : null
      if (!next) dismissed = null
      set(next && dismissed === next.from ? null : next)
    }
    return [
      new Plugin({
        key: new PluginKey('gyeolTrigger'),
        view: () => ({
          update: (view) => evaluate(view),
          destroy: () => set(null),
        }),
        props: {
          handleKeyDown: (_view, e) => {
            if (!current || e.isComposing || e.keyCode === 229) return false
            if (e.key === 'Escape') {
              dismissed = current.from
              set(null)
              // ProseMirror는 Esc를 늘 preventDefault하므로, '제안 상자를 닫는 데 쓴 Esc'는 따로 표시한다(노트 화면이 보고 손을 떼지 않음)
              ;(e as KeyboardEvent & { gyeolHandled?: boolean }).gyeolHandled = true
              return true
            }
            return opts.onKey(e)
          },
          handleDOMEvents: {
            [TRIGGER_DISMISS]: () => {
              if (current) {
                dismissed = current.from
                set(null)
              }
              return true
            },
            compositionend: (view) => {
              setTimeout(() => evaluate(view), 0)
              return false
            },
            blur: () => {
              setTimeout(() => set(null), 120)
              return false
            },
            focus: (view) => {
              setTimeout(() => evaluate(view), 0)
              return false
            },
          },
        },
      }),
    ]
  },
})

/* ---------- 사진 블록 ---------- */

export const Asset = Node.create({
  name: 'asset',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { assetId: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'figure[data-asset]', getAttrs: (el) => ({ assetId: (el as HTMLElement).getAttribute('data-asset') }) }]
  },
  renderHTML({ node }) {
    return ['figure', { 'data-asset': String(node.attrs.assetId ?? ''), class: 'nb-asset' }]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure')
      dom.className = 'nb-asset'
      dom.contentEditable = 'false'
      const img = document.createElement('img')
      img.alt = '사진'
      dom.appendChild(img)
      let url = ''
      let dead = false
      const id = node.attrs.assetId as string | null
      if (id)
        void db.assets.get(id).then((a) => {
          if (dead || !a) return
          url = URL.createObjectURL(a.blob)
          img.src = url
        })
      return {
        dom,
        destroy: () => {
          dead = true
          if (url) URL.revokeObjectURL(url)
        },
      }
    }
  },
})

/* ---------- 소리 칩 (음성 메모 → 노트로, 리더 결정 6) ---------- */

const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 소리 칩 블록: ▶/❚❚ + 길이(모노). 소리는 assets의 Blob(누를 때 처음 읽는다) */
export const Voice = Node.create({
  name: 'voice',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { assetId: { default: null }, durationMs: { default: 0 } }
  },
  parseHTML() {
    return [{ tag: 'div[data-voice]', getAttrs: (el) => ({ assetId: (el as HTMLElement).getAttribute('data-voice'), durationMs: Number((el as HTMLElement).getAttribute('data-ms') ?? 0) }) }]
  },
  renderHTML({ node }) {
    return ['div', { 'data-voice': String(node.attrs.assetId ?? ''), 'data-ms': String(node.attrs.durationMs ?? 0), class: 'nb-voice' }]
  },
  renderText() {
    return ''
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'nb-voice'
      dom.contentEditable = 'false'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'nb-voice-play'
      btn.setAttribute('aria-label', '재생')
      btn.setAttribute('data-tip', '')
      const icon = (playing: boolean) =>
        (btn.innerHTML = playing
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.2" height="12" rx="1"/><rect x="13.8" y="6" width="3.2" height="12" rx="1"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>')
      icon(false)
      const bar = document.createElement('span')
      bar.className = 'nb-voice-bar'
      const fill = document.createElement('i')
      bar.appendChild(fill)
      const time = document.createElement('span')
      time.className = 'nb-voice-t'
      const total = Number(node.attrs.durationMs ?? 0)
      time.textContent = fmtDur(total)
      dom.append(btn, bar, time)
      let audio: HTMLAudioElement | null = null
      let url = ''
      let dead = false
      let raf = 0
      const tick = () => {
        if (!audio || dead) return
        const d = (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : total) || 1
        fill.style.transform = `scaleX(${Math.min(1, (audio.currentTime * 1000) / d)})`
        time.textContent = fmtDur(audio.paused ? d : audio.currentTime * 1000)
        if (!audio.paused) raf = requestAnimationFrame(tick)
      }
      const stop = () => {
        icon(false)
        btn.setAttribute('aria-label', '재생')
        cancelAnimationFrame(raf)
        tick()
      }
      btn.addEventListener('mousedown', (e) => e.preventDefault()) // 편집기 선택을 바꾸지 않는다
      btn.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!audio) {
          const id = node.attrs.assetId as string | null
          const a = id ? await db.assets.get(id) : undefined
          if (!a || dead) {
            dom.classList.add('is-missing')
            return
          }
          url = URL.createObjectURL(a.blob)
          audio = new Audio(url)
          audio.addEventListener('ended', () => {
            if (audio) audio.currentTime = 0
            stop()
          })
          audio.addEventListener('pause', stop)
        }
        if (audio.paused) {
          await audio.play().catch(() => dom.classList.add('is-missing'))
          icon(true)
          btn.setAttribute('aria-label', '멈춤')
          raf = requestAnimationFrame(tick)
        } else audio.pause()
      })
      return {
        dom,
        stopEvent: (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('.nb-voice-play'),
        ignoreMutation: () => true,
        destroy: () => {
          dead = true
          cancelAnimationFrame(raf)
          audio?.pause()
          if (url) URL.revokeObjectURL(url)
        },
      }
    }
  },
})
