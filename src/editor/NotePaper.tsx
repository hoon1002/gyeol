/**
 * 노트 종이 = 편집기 (design-m2 3장 · 4장). 노트를 열 때 동적 import로 불러온다(첫 화면 번들 밖).
 *
 * 평평한 종이 · 17px(폰 16)/1.75 · 글 너비 ≤ 600px · 툴바 없음(마크다운 단축 + 빈 줄 맨 앞 `/`).
 * 자동 저장: 0.6초 디바운스로 saveBody(noteBodies · notes.updatedAt·excerpt · links). 메타 줄 끝 4px 점이 상태다.
 * 한글 입력: compositionstart ~ end 동안 저장 타이머 · `[[` 제안 · `/` 메뉴 · 단축키를 멈춘다.
 *   (ProseMirror는 조합 중 keydown을 keymap에 넘기지 않으므로 Enter가 문단을 자르지 않는다. 입력 규칙도 조합 끝에 한 번 평가된다.)
 */
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react'
import { useFieldPause, useSkyEvent } from '@/fx'
import { db, type Note, type Subject } from '@/db/schema'
import { applyTemplateMeta, deleteNote, openOrCreateNote, renameNote, saveBody, setNoteSubject } from '@/db/notes'
import { matchText } from '@/lib/hangul'
import { fmtMD } from '@/lib/time'
import { useGo, useIsPhone } from '@/shell/hooks'
import { IconBack, IconDoc, IconLink, IconMap, IconMore, IconPlus, IconTrash } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { Hint } from '@/shell/Hint'
import { pushLayer } from '@/shell/layers'
import { Asset, LinkDecor, NoteLink, Trigger, dismissTrigger, refreshLinkDecor, type LinkAttrs, type LinkResolver, type TriggerState } from './extensions'
import { Backlinks } from './Backlinks'
import { templateDoc, type PMNode, type TemplateName } from './templates'
import '@/styles/editor.css'

export interface NotePaperProps {
  note: Note
  notes: Note[]
  subjects: Subject[]
  /** 수업 노트면 강의실 (메타 줄) */
  room?: string | null
  active: boolean
  /** 열자마자 제목에 커서 (새 노트) */
  focusTitle?: boolean
  onOpenNote: (id: string) => void
  onBack?: () => void
  onDeleted?: () => void
}

type SaveState = 'saved' | 'dirty' | 'error'

const EMPTY_DOC: PMNode = { type: 'doc', content: [{ type: 'paragraph' }] }

/** 이 편집기가 아는 노드만 남긴다(모르는 블록이 있어도 열리게) */
const KNOWN = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'noteLink', 'asset'])
function sanitize(n: PMNode): PMNode | null {
  if (!KNOWN.has(n.type)) return n.text ? { type: 'text', text: n.text } : null
  if (n.type === 'text' && !n.text) return null
  const content = n.content?.map(sanitize).filter((c): c is PMNode => !!c)
  return { ...n, ...(content ? { content } : {}) }
}

/** 수업 노트는 수업 날짜('과목|YYYY-MM-DD') */
function classDate(key: string | null | undefined): Date | null {
  const m = key ? /\|(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

const subjColor = (s: Subject | undefined | null) => (s ? `var(--s-${s.color})` : null)

export default function NotePaper(props: NotePaperProps) {
  const { note } = props
  const [initial, setInitial] = useState<{ id: string; doc: PMNode; version: number } | null>(null)
  useEffect(() => {
    let dead = false
    void db.noteBodies.get(note.id).then((b) => {
      if (dead) return
      const doc: PMNode = (b?.doc ? sanitize(b.doc as PMNode) : null) ?? EMPTY_DOC
      setInitial({ id: note.id, doc: doc.content?.length ? doc : EMPTY_DOC, version: b?.version ?? 0 })
    })
    return () => {
      dead = true
    }
  }, [note.id])
  const subject = props.subjects.find((s) => s.id === note.subjectId) ?? null
  return (
    <article className="np" style={{ ['--c' as string]: subjColor(subject) ?? 'var(--text-3)' }} aria-label={note.title.trim() || fmtMD(classDate(note.classKey) ?? note.createdAt)}>
      {initial && initial.id === note.id ? <PaperBody key={note.id} {...props} subject={subject} initial={initial} /> : <PaperSkeleton />}
    </article>
  )
}

export function PaperSkeleton() {
  return (
    <div className="np-scroll" aria-hidden="true">
      <div className="np-col">
        <div className="np-skel-t" />
        <div className="np-skel-m" />
        <div className="np-skel-l" />
        <div className="np-skel-l" style={{ width: '82%' }} />
        <div className="np-skel-l" style={{ width: '64%' }} />
      </div>
    </div>
  )
}

/* ---------- 종이 몸통 ---------- */

function PaperBody(props: NotePaperProps & { subject: Subject | null; initial: { doc: PMNode; version: number } }) {
  const { note, notes, subjects, subject, initial, active } = props
  const sky = useSkyEvent()
  const phone = useIsPhone()
  const [save, setSave] = useState<SaveState>('saved')
  const [focused, setFocused] = useState(false)
  const [trigger, setTrigger] = useState<TriggerState | null>(null)
  // 빈 문서: 첫 노트 한 번만 키 그림(H6 · '/' '[[') — 그 뒤엔 커서만
  const [empty, setEmpty] = useState(() => !initial.doc.content?.some((b) => (b.content?.length ?? 0) > 0 || (b.type !== 'paragraph')))
  const scrollRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useFieldPause(active && focused, 'ink')

  // ----- 링크 해석: id → 노트, 없으면 같은 제목 -----
  const noteMaps = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]))
    const byTitle = new Map<string, Note>()
    notes.forEach((n) => {
      const t = n.title.trim()
      const prev = t ? byTitle.get(t) : undefined
      if (t && (!prev || prev.updatedAt < n.updatedAt)) byTitle.set(t, n)
    })
    return { byId, byTitle }
  }, [notes])
  const colorOf = useCallback((n: Note) => subjColor(subjects.find((s) => s.id === n.subjectId)), [subjects])
  const resolveRef = useRef<LinkResolver>(() => null)
  resolveRef.current = (a: LinkAttrs) => {
    const n = (a.to ? noteMaps.byId.get(a.to) : undefined) ?? noteMaps.byTitle.get(a.title.trim())
    return n ? { id: n.id, color: colorOf(n) } : null
  }

  // ----- 열기: 링크 누르기 -----
  const openRef = useRef<(a: LinkAttrs) => void>(() => {})
  openRef.current = (a: LinkAttrs) => {
    const hit = resolveRef.current(a)
    if (hit) return props.onOpenNote(hit.id)
    // 없는 노트: 그 제목으로 빈 노트(과목은 지금 노트와 같게)를 만들고 연다
    void openOrCreateNote({ title: a.title, subjectId: note.subjectId }).then((r) => props.onOpenNote(r.note.id))
  }

  // ----- 제안 상자 키 · 밖에서 닫기(겹침 층 Esc) -----
  const keyRef = useRef<(e: KeyboardEvent) => boolean>(() => false)
  const dismissRef = useRef<() => void>(() => dismissTrigger(editorRef.current?.view.dom))

  // ----- 자동 저장 -----
  // 문서를 그 자리에서(동기) 찍어 저장 줄에 세운다. 노트를 바꾸거나(언마운트) 화면을 떠나도 찍어 둔 것이 저장된다.
  const st = useRef({ timer: 0, dirty: false, composing: false, version: initial.version, saves: 0, held: 0, pending: 0, dead: false, chain: Promise.resolve() as Promise<unknown> })
  const editorRef = useRef<Editor | null>(null)
  const noteId = note.id
  const schedule = useCallback(() => {
    const s = st.current
    window.clearTimeout(s.timer)
    s.timer = window.setTimeout(() => commitRef.current(false), 600)
  }, [])
  const commit = useCallback(
    (force: boolean) => {
      const s = st.current
      const ed = editorRef.current
      window.clearTimeout(s.timer)
      s.timer = 0
      if (!s.dirty || !ed || ed.isDestroyed) return
      if (!force && (s.composing || ed.view.composing)) {
        s.held++ // 조합이 끝나면 compositionend가 다시 부른다
        return
      }
      const json = ed.getJSON()
      s.dirty = false
      s.pending++
      const write = async (tries: number): Promise<void> => {
        try {
          const r = await saveBody(noteId, json)
          s.version = r.version
          s.saves++
          r.added.forEach(([a, b]) => sky.drawLink(a, b, { layer: 'graph', deferIfPaused: true }))
          if (!s.dead) setSave(s.dirty ? 'dirty' : 'saved')
        } catch {
          if (s.dead) {
            // 이미 떠난 노트: 찍어 둔 문서를 한 번 더 시도
            if (tries < 2) await new Promise((r) => setTimeout(r, 800)).then(() => write(tries + 1))
            return
          }
          s.dirty = true
          setSave('error')
          schedule()
        }
      }
      s.chain = s.chain.then(() => write(0)).finally(() => {
        s.pending--
      })
    },
    [noteId, sky, schedule],
  )
  const commitRef = useRef(commit)
  commitRef.current = commit

  const noteTemplate = useRef<TemplateName | null | undefined>(note.template)
  noteTemplate.current = note.template ?? noteTemplate.current
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2] },
          link: false,
          underline: false,
          codeBlock: { HTMLAttributes: { spellcheck: 'false' } },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        NoteLink.configure({ onOpen: (a) => openRef.current(a) }),
        LinkDecor.configure({ resolve: () => resolveRef.current }),
        Trigger.configure({ onChange: (s) => setTrigger(s), onKey: (e) => keyRef.current(e) }),
        Asset,
      ],
      content: initial.doc,
      editorProps: {
        attributes: { class: 'np-prose', 'aria-label': '본문', spellcheck: 'false' },
        scrollThreshold: { top: 24, bottom: 96, left: 0, right: 0 },
        scrollMargin: { top: 24, bottom: 96, left: 0, right: 0 },
        // 본문 맨 앞에서 ↑ → 제목 끝으로 (제목 Enter → 본문의 짝)
        handleKeyDown: (view, e) => {
          if (e.key !== 'ArrowUp' || e.isComposing || e.keyCode === 229 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false
          const sel = view.state.selection
          const t = titleRef.current
          if (!sel.empty || sel.from > 1 || !t) return false
          e.preventDefault()
          t.focus()
          t.setSelectionRange(t.value.length, t.value.length)
          return true
        },
      },
      onUpdate: ({ editor: ed, transaction }) => {
        if (!transaction.docChanged) return
        setEmpty(ed.isEmpty)
        const s = st.current
        s.dirty = true
        setSave('dirty')
        if (!s.composing) schedule()
      },
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false)
        commitRef.current(false)
      },
    },
    [note.id],
  )
  editorRef.current = editor

  // 조합 경계: 저장 타이머를 멈췄다가 끝나면 다시
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const start = () => {
      st.current.composing = true
      window.clearTimeout(st.current.timer)
    }
    const end = () => {
      st.current.composing = false
      if (st.current.dirty) schedule()
    }
    dom.addEventListener('compositionstart', start)
    dom.addEventListener('compositionend', end)
    return () => {
      dom.removeEventListener('compositionstart', start)
      dom.removeEventListener('compositionend', end)
    }
  }, [editor, schedule])

  // 떠날 때 · 숨길 때 · 다른 노트로 바꿀 때(언마운트) 바로 저장 — 조합 중이어도 지금 문서를 찍는다
  useEffect(() => {
    const s = st.current
    s.dead = false
    const flush = () => {
      s.composing = false
      commitRef.current(true)
    }
    const onVis = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
      flush()
      s.dead = true
    }
  }, [])

  // 밖에서 본문이 바뀌면(별가루 '노트로' 붙이기 등) 고치는 중이 아닐 때 다시 읽는다
  const extVersion = useLiveQuery(async () => (await db.noteBodies.get(note.id))?.version ?? 0, [note.id])
  useEffect(() => {
    const s = st.current
    if (!editor || extVersion === undefined || extVersion <= s.version || s.dirty || s.pending) return
    void db.noteBodies.get(note.id).then((b) => {
      if (!b || editor.isDestroyed || st.current.dirty || b.version <= st.current.version) return
      st.current.version = b.version
      const doc = sanitize(b.doc as PMNode) ?? EMPTY_DOC
      editor.commands.setContent(doc.content?.length ? doc : EMPTY_DOC, { emitUpdate: false })
    })
  }, [extVersion, editor, note.id])

  // 틀이 바뀌면 자리표시 다시
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, note.template])

  // 노트가 생기거나 지워지면 링크 모양 다시
  useEffect(() => {
    if (editor && !editor.isDestroyed) refreshLinkDecor(editor.view)
  }, [noteMaps, colorOf, editor])

  // 새 노트: 제목에 커서
  useEffect(() => {
    if (props.focusTitle) requestAnimationFrame(() => titleRef.current?.focus())
  }, [props.focusTitle])

  // 폰 · 태블릿: 키보드 높이만큼 아래 여백(+24px)
  useEffect(() => {
    const vv = window.visualViewport
    const el = scrollRef.current
    if (!vv || !el) return
    const on = () => el.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`)
    on()
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    return () => {
      vv.removeEventListener('resize', on)
      vv.removeEventListener('scroll', on)
    }
  }, [])

  // 개발용: 조합 시험 스크립트가 읽는다
  useEffect(() => {
    if (!import.meta.env.DEV || !editor) return
    const w = window as unknown as { __gyeolEditor?: unknown }
    const ctx = { editor, noteId: note.id, stats: st.current, trigger: () => triggerRef.current }
    w.__gyeolEditor = ctx
    ;(w as { __gyeolImeTest?: unknown }).__gyeolImeTest = () => import('./imeTest').then((m) => m.runImeTest(ctx))
    return () => {
      if ((w.__gyeolEditor as { editor?: unknown } | undefined)?.editor === editor) delete w.__gyeolEditor
    }
  }, [editor, note.id])
  const triggerRef = useRef(trigger)
  triggerRef.current = trigger

  const applyTemplate = useCallback(
    async (name: TemplateName) => {
      if (!editor) return
      noteTemplate.current = name
      editor.commands.setContent(templateDoc(name), { emitUpdate: true })
      await applyTemplateMeta(note.id, name)
      if (name === 'concept' && !note.title.trim()) titleRef.current?.focus()
      else editor.commands.focus('start')
    },
    [editor, note.id, note.title],
  )

  const room = props.room
  const dateText = fmtMD(classDate(note.classKey) ?? note.createdAt)
  return (
    <div className="np-scroll" ref={scrollRef}>
      <div className="np-col">
        <div className="np-top">
          {props.onBack && (
            <button type="button" className="ibtn np-back" {...tip('노트 목록', { kbd: 'esc' })} onClick={props.onBack}>
              <IconBack size={20} />
            </button>
          )}
          <NoteMenu note={note} subjects={subjects} onDeleted={props.onDeleted} />
        </div>
        <TitleField ref={titleRef} note={note} placeholder={dateText} onEnter={() => editor?.commands.focus('start')} />
        <p className="np-meta">
          <i className={`sdot${subject ? '' : ' is-none'}`} style={subject ? { ['--c' as string]: `var(--s-${subject.color})` } : undefined} tabIndex={0} {...tip(subject?.name ?? '과목 없음')} />
          <span className="mono" {...(room ? { tabIndex: 0, ...tip(room) } : {})}>
            {dateText}
          </span>
          <span className={`np-save is-${save}`} role="status" aria-label={save === 'saved' ? '저장됨' : save === 'dirty' ? '저장 중' : '저장 실패'} />
        </p>
        {save === 'error' && <p className="np-err">저장하지 못했어요. 저장 공간을 확인해 주세요.</p>}
        <div className="np-editor-wrap">
          {empty && (
            <span className="np-h6" aria-hidden="true">
              <Hint id="H6" side="right" active={empty} />
            </span>
          )}
          <EditorContent editor={editor} className="np-editor" />
        </div>
        <Backlinks noteId={note.id} title={note.title} onOpen={props.onOpenNote} />
      </div>
      {editor && trigger && (
        <TriggerMenu
          editor={editor}
          state={trigger}
          phone={phone}
          notes={notes}
          subjects={subjects}
          currentId={note.id}
          keyRef={keyRef}
          dismiss={() => dismissRef.current()}
          onTemplate={applyTemplate}
          onCreateTitle={async (title) => {
            const r = await openOrCreateNote({ title, subjectId: note.subjectId })
            return r.note.id
          }}
        />
      )}
    </div>
  )
}

/* ---------- 제목 ---------- */

function TitleField({ note, placeholder, onEnter, ref }: { note: Note; placeholder: string; onEnter: () => void; ref: Ref<HTMLTextAreaElement> }) {
  const [v, setV] = useState(note.title)
  const st = useRef({ composing: false, timer: 0, dirty: false })
  const own = useRef<HTMLTextAreaElement | null>(null)
  const latest = useRef({ v: note.title, title: note.title, id: note.id })
  latest.current = { v, title: note.title, id: note.id }
  // 다른 노트로 바꾸거나 화면을 떠나면(언마운트) 고치던 제목을 바로 저장 — 조합 중이어도
  useEffect(
    () => () => {
      window.clearTimeout(st.current.timer)
      const l = latest.current
      if (st.current.dirty && l.v.trim() !== l.title) void renameNote(l.id, l.v)
    },
    [],
  )
  // 밖에서 제목이 바뀌면(수업 틀 적용 등) 고치는 중이 아닐 때 따라간다
  useEffect(() => {
    if (!st.current.dirty && document.activeElement !== own.current) setV(note.title)
  }, [note.title])
  const commit = useCallback(
    (val: string) => {
      window.clearTimeout(st.current.timer)
      st.current.timer = 0
      if (st.current.composing) return
      st.current.dirty = false
      if (val.trim() !== note.title) void renameNote(note.id, val)
    },
    [note.id, note.title],
  )
  const schedule = (val: string) => {
    st.current.dirty = true
    window.clearTimeout(st.current.timer)
    if (!st.current.composing) st.current.timer = window.setTimeout(() => commit(val), 600)
  }
  useEffect(() => {
    const el = own.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }, [v])
  return (
    <textarea
      ref={(el) => {
        own.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as RefObject<HTMLTextAreaElement | null>).current = el
      }}
      className="np-title"
      rows={1}
      value={v}
      placeholder={placeholder}
      aria-label="제목"
      spellCheck={false}
      onChange={(e) => {
        const val = e.target.value.replace(/\n/g, ' ')
        setV(val)
        schedule(val)
      }}
      onCompositionStart={() => {
        st.current.composing = true
        window.clearTimeout(st.current.timer)
      }}
      onCompositionEnd={(e) => {
        st.current.composing = false
        schedule((e.target as HTMLTextAreaElement).value)
      }}
      onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
          e.preventDefault()
          commit(e.currentTarget.value)
          onEnter()
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  )
}

/* ---------- ⋯ 메뉴: 과목 바꾸기 · 지도에서 보기 · 지우기 ---------- */

function NoteMenu({ note, subjects, onDeleted }: { note: Note; subjects: Subject[]; onDeleted?: () => void }) {
  const [open, setOpen] = useState<null | 'menu' | 'subject'>(null)
  const [arm, setArm] = useState(false)
  const cur = subjects.find((s) => s.id === note.subjectId)
  const box = useRef<HTMLDivElement>(null)
  const go = useGo()
  const sky = useSkyEvent()
  useEffect(() => {
    if (!open) {
      setArm(false)
      return
    }
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(null)
    document.addEventListener('pointerdown', off)
    // 겹침 층: Esc는 이 메뉴만 닫고(노트 목록으로 돌아가지 않음) 포커스는 ⋯ 버튼으로
    const release = pushLayer({ id: 'note-menu', close: () => setOpen(null), restoreFocusTo: box.current?.querySelector('.np-more') ?? null, el: box.current })
    return () => {
      document.removeEventListener('pointerdown', off)
      release()
    }
  }, [open])
  return (
    <div className="np-menu" ref={box}>
      <button type="button" className="ibtn np-more" {...tip('노트 메뉴')} aria-expanded={!!open} onClick={() => setOpen(open ? null : 'menu')}>
        <IconMore size={18} />
      </button>
      {open === 'menu' && (
        <div className="np-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => setOpen('subject')}>
            <span className="np-pop-ic" aria-hidden="true">
              <i className={`sdot is-lg${cur ? '' : ' is-none'}`} style={cur ? { ['--c' as string]: `var(--s-${cur.color})` } : undefined} />
            </span>
            과목 바꾸기
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              setOpen(null)
              const el = e.currentTarget
              void go('/map', el).then(() => sky.select(note.id))
            }}
          >
            <span className="np-pop-ic" aria-hidden="true">
              <IconMap size={18} />
            </span>
            지도에서 보기
          </button>
          <button
            type="button"
            role="menuitem"
            className={arm ? 'is-danger' : undefined}
            onClick={() => {
              if (!arm) return setArm(true)
              setOpen(null)
              void deleteNote(note.id).then(() => onDeleted?.())
            }}
          >
            <span className="np-pop-ic" aria-hidden="true">
              <IconTrash size={18} />
            </span>
            {arm ? '한 번 더' : '지우기'}
          </button>
        </div>
      )}
      {open === 'subject' && (
        <div className="np-pop" role="menu" aria-label="과목">
          {[null, ...subjects].map((s) => (
            <button
              key={s?.id ?? 'none'}
              type="button"
              role="menuitemradio"
              aria-checked={(s?.id ?? null) === note.subjectId}
              onClick={() => {
                setOpen(null)
                void setNoteSubject(note.id, s?.id ?? null)
              }}
            >
              <span className="np-pop-ic" aria-hidden="true">
                <i className={`sdot is-lg${s ? '' : ' is-none'}`} style={s ? { ['--c' as string]: `var(--s-${s.color})` } : undefined} />
              </span>
              {s?.name ?? '과목 없음'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- `[[` 제안 · `/` 메뉴 ---------- */

interface MenuItem {
  id: string
  label: string
  range?: [number, number] | null
  dot?: string | null
  /** 앞 표시: 블록 = 마크다운 글자, 틀 = 문서 아이콘 */
  lead?: ReactNode
  /** [[ 제안: 이 노트를 가리키는 링크 수 */
  links?: number
  run: () => void
}

const BLOCKS: Array<{ id: string; label: string; keys: string[]; hint: string }> = [
  { id: 'p', label: '문단', keys: ['문단', 'text', 'paragraph', 'p'], hint: '' },
  { id: 'h1', label: '제목 1', keys: ['제목', 'heading', 'h1', '#'], hint: '#' },
  { id: 'h2', label: '제목 2', keys: ['제목', 'heading', 'h2', '##'], hint: '##' },
  { id: 'ul', label: '목록', keys: ['목록', 'list', 'bullet', 'ul', '-'], hint: '-' },
  { id: 'ol', label: '번호 목록', keys: ['번호', 'number', 'ordered', 'ol', '1.'], hint: '1.' },
  { id: 'task', label: '체크', keys: ['체크', '할 일', 'todo', 'task', 'check', '[]'], hint: '[ ]' },
  { id: 'quote', label: '인용', keys: ['인용', 'quote', 'blockquote', '>'], hint: '>' },
  { id: 'code', label: '코드', keys: ['코드', 'code', '```'], hint: '```' },
  { id: 'hr', label: '구분선', keys: ['구분선', 'divider', 'hr', 'line', '---'], hint: '---' },
]

function TriggerMenu(props: {
  editor: Editor
  state: TriggerState
  phone: boolean
  notes: Note[]
  subjects: Subject[]
  currentId: string
  keyRef: RefObject<(e: KeyboardEvent) => boolean>
  dismiss: () => void
  onTemplate: (t: TemplateName) => void
  onCreateTitle: (title: string) => Promise<string>
}) {
  const { editor, state, notes, subjects } = props
  const [sel, setSel] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const linkCounts = useLiveQuery(async () => {
    const m = new Map<string, number>()
    if (state.kind !== 'link') return m
    ;(await db.links.toArray()).forEach((l) => l.to && m.set(l.to, (m.get(l.to) ?? 0) + 1))
    return m
  }, [state.kind])

  const items = useMemo<MenuItem[]>(() => {
    const q = state.query.trim()
    const replace = (content: object | object[]) => editor.chain().focus().insertContentAt({ from: state.from, to: state.to }, content).run()
    if (state.kind === 'link') {
      const ranked = notes
        .filter((n) => n.id !== props.currentId && n.title.trim())
        .map((n) => ({ n, m: matchText(n.title, q) }))
        .filter((x) => x.m.score > 0)
        .sort((a, b) => b.m.score - a.m.score || b.n.updatedAt - a.n.updatedAt)
        .slice(0, 6)
      const out: MenuItem[] = ranked.map(({ n, m }) => {
        const s = subjects.find((x) => x.id === n.subjectId)
        const c = linkCounts?.get(n.id) ?? 0
        return {
          id: n.id,
          label: n.title,
          range: q ? m.range : null,
          dot: s ? `var(--s-${s.color})` : 'var(--text-3)',
          links: c,
          run: () => replace({ type: 'noteLink', attrs: { to: n.id, title: n.title.trim() } }),
        }
      })
      if (q && !notes.some((n) => n.title.trim() === q)) {
        out.push({
          id: 'new',
          label: `‘${q}’`,
          lead: <IconPlus size={16} />,
          run: () => {
            replace({ type: 'noteLink', attrs: { to: null, title: q } })
            void props.onCreateTitle(q)
          },
        })
      }
      return out
    }
    const out: MenuItem[] = []
    BLOCKS.forEach((b) => {
      const m = matchText(b.label, q, b.keys)
      if (q && m.score <= 0) return
      out.push({
        id: b.id,
        label: b.label,
        range: q ? m.range : null,
        lead: <span className="np-sg-key">{b.hint || '¶'}</span>,
        run: () => {
          const c = editor.chain().focus().deleteRange({ from: state.from, to: state.to })
          if (b.id === 'p') c.setParagraph()
          else if (b.id === 'h1') c.setHeading({ level: 1 })
          else if (b.id === 'h2') c.setHeading({ level: 2 })
          else if (b.id === 'ul') c.toggleBulletList()
          else if (b.id === 'ol') c.toggleOrderedList()
          else if (b.id === 'task') c.toggleTaskList()
          else if (b.id === 'quote') c.toggleBlockquote()
          else if (b.id === 'code') c.setCodeBlock()
          else if (b.id === 'hr') c.setHorizontalRule()
          c.run()
        },
      })
    })
    // 문서가 비어 있을 때만(지금 쓰는 '/' 한 줄뿐) 틀
    const d = editor.state.doc
    if (d.childCount === 1) {
      ;([['class', '수업 노트 틀', ['수업', 'class', '틀', 'template']], ['concept', '개념 정리 틀', ['개념', 'concept', '틀', 'template']]] as const).forEach(([t, label, keys]) => {
        const m = matchText(label, q, [...keys])
        if (q && m.score <= 0) return
        out.push({ id: 'tpl-' + t, label, range: q ? m.range : null, lead: <IconDoc size={16} />, run: () => props.onTemplate(t) })
      })
    }
    return out
  }, [state, notes, subjects, editor, linkCounts, props])

  useEffect(() => setSel(0), [state.kind, state.query])

  props.keyRef.current = (e: KeyboardEvent) => {
    if (!items.length) return false
    if (e.key === 'ArrowDown') {
      setSel((i) => (i + 1) % items.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      setSel((i) => (i - 1 + items.length) % items.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      items[Math.min(sel, items.length - 1)]?.run()
      return true
    }
    return false
  }

  // 자리: 커서 아래 6px. 화면(키보드 위 보이는 영역) 아래로 잘리면 커서 위로 뒤집는다. 폰은 키보드 바로 위, 종이 폭 − 16px
  const boxRef = useRef<HTMLDivElement>(null)
  // 겹침 층: 열려 있는 동안 Esc는 이 상자만 닫는다(그 자리의 `[[`·`/` 글자는 남음). 포커스는 편집기에 그대로
  const dismissFn = useRef(props.dismiss)
  dismissFn.current = props.dismiss
  const shown = items.length > 0
  useEffect(() => (shown ? pushLayer({ id: 'editor-suggest', close: () => dismissFn.current(), el: boxRef.current }) : undefined), [shown])
  useLayoutEffect(() => {
    const place = () => {
      if (props.phone) return setPos(null)
      try {
        const c = editor.view.coordsAtPos(state.from)
        const vv = window.visualViewport
        const bottomEdge = vv ? vv.offsetTop + vv.height : window.innerHeight
        const h = boxRef.current?.offsetHeight ?? Math.min(items.length, 7) * 40 + 10
        const w = boxRef.current?.offsetWidth ?? 320
        const left = Math.max(8, Math.min(c.left, window.innerWidth - w - 8))
        const below = c.bottom + 6
        const up = below + h > bottomEdge - 8 && c.top - 6 - h >= 8
        const top = up ? c.top - 6 - h : Math.max(8, Math.min(below, bottomEdge - 8 - h))
        setPos((p) => (p && p.left === left && p.top === top && p.up === up ? p : { left, top, up }))
      } catch {
        setPos(null)
      }
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [editor, state.from, state.query, props.phone, items.length])

  const [kb, setKb] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!props.phone || !vv) return
    const on = () => setKb(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    on()
    vv.addEventListener('resize', on)
    return () => vv.removeEventListener('resize', on)
  }, [props.phone])

  if (!items.length) return null
  // 처음 한 번은 보이지 않게 그려 높이를 잰 뒤 자리를 잡는다
  const style = props.phone ? { left: 8, right: 8, bottom: kb + 8 } : pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' as const }
  return (
    <div ref={boxRef} className={`np-suggest${props.phone ? ' is-phone' : ''}${pos?.up ? ' is-up' : ''}`} style={style} role="listbox" aria-label={state.kind === 'link' ? '노트 링크' : '블록'} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="option"
          aria-selected={i === sel}
          aria-label={it.id === 'new' ? `새 노트 ${it.label}` : undefined}
          className={`np-sg-row${i === sel ? ' is-sel' : ''}${it.id === 'new' ? ' is-new' : ''}`}
          onMouseEnter={() => setSel(i)}
          onClick={() => it.run()}
        >
          {it.lead ? (
            <span className="np-sg-lead" aria-hidden="true">
              {it.lead}
            </span>
          ) : (
            <i className="np-sg-dot" style={{ background: it.dot ?? 'var(--text-3)' }} aria-hidden="true" />
          )}
          <span className="np-sg-t">
            <Hl text={it.label} range={it.range} />
          </span>
          {it.links ? (
            <span className="np-sg-r" aria-label={`링크 ${it.links}`}>
              <IconLink size={13} />
              {it.links}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function Hl({ text, range }: { text: string; range?: [number, number] | null }) {
  if (!range) return <>{text}</>
  const a = Array.from(text)
  return (
    <>
      {a.slice(0, range[0]).join('')}
      <b>{a.slice(range[0], range[1]).join('')}</b>
      {a.slice(range[1]).join('')}
    </>
  )
}
