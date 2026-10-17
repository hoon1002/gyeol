/**
 * 별 누르기 (design-v3-camera §3): 데이터 별(오늘의 별·시험 별·복습 별·그래프 별)을 누르면
 * useSkyPick으로 찾고 useSkyCamera.flyTo로 그 별을 '별 좌석'에 앉힌다. 왼쪽 글자 구역엔 명사구 / 메타 / 동작 하나.
 * 닫기(× · Esc · 빈 하늘 누르기) = back(). 별 안에서 다른 별을 누르면 옆으로 날아간다.
 * 하늘 끌기·핀치·관성·휠 뒤에 오는 click은 누르기가 아니다(isDragClick) — 끌어 돌린 뒤 떼도 패널·자리를 그대로 둔다 (M3).
 * 비행 중 누름은 엔진 규칙대로(무시/도착 뒤 처리). 포인터가 별 위에 있으면 커서가 바뀐다.
 */
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { pushLayer } from './layers'
import { useSkyCamera, useSkyEvent, useSkyPick, type CameraTarget } from '@/fx'
import { db } from '@/db/schema'
import { graphNodeInfo } from '@/lib/graph'
import { ddayOf, fmtDday, fmtHM, fmtMD, MIN, studyDayRange } from '@/lib/time'
import { useUi } from '@/stores/ui'
import { useGo } from './hooks'
import { IconArrow, IconClose, IconFocus, IconLink, IconNote, IconReview } from './icons'
import { tip } from './Tip'
import type { SpacePath } from './spaces'

/** 별 정보 한 칸의 숫자 조각 (design-quiet 1-6: 메타 글 대신 색 점 + 숫자 + 아이콘) */
interface Chip {
  kind: 'dot' | 'num' | 'link' | 'review' | 'focus'
  text?: string
  /** 점 색(css) — 없으면 빈 고리 */
  color?: string | null
  tip?: string
}

interface StarInfo {
  id: string
  title: string
  /** 화면에는 chips, 스크린리더·툴팁에는 이 문장 */
  meta: string
  chips: Chip[]
  action: { icon: 'note' | 'review' | 'arrow'; label: string; run: (el: Element | null) => void } | null
  zoom: (z: number) => number
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="dialog"], [role="button"], .dock, .topbar, .palette, .sheet-layer, .star-info, .flash, .week-grid, .cont, .recent'

export function StarPress() {
  const { pick, isDragClick } = useSkyPick()
  const cam = useSkyCamera()
  const sky = useSkyEvent()
  const go = useGo()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const [info, setInfo] = useState<StarInfo | null>(null)
  const infoRef = useRef<StarInfo | null>(null)
  const home = useRef<CameraTarget | null>(null)
  const hops = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  infoRef.current = info

  const subjectName = async (id: string | null | undefined) => (id ? (await db.subjects.get(id))?.name ?? '자유' : '자유')
  const subjectDot = async (id: string | null | undefined): Promise<Chip> => {
    const sub = id ? await db.subjects.get(id) : undefined
    return { kind: 'dot', color: sub ? `var(--s-${sub.color})` : null, tip: sub?.name ?? '자유' }
  }

  const goTo = (to: SpacePath, el: Element | null) => {
    // 동작을 누르면 그 공간으로 이어서 난다 — back() 기록은 지운다
    home.current = null
    hops.current = 0
    setInfo(null)
    sky.select(null)
    void go(to, el)
  }

  async function resolve(id: string, layer: string): Promise<StarInfo | null> {
    const ui = useUi.getState()
    if (layer === 'today' || layer === 'focus') {
      // 하늘이 개수만으로 만든 오늘의 별은 'today:N'(N번째 세트) — 오늘(학습일) 끝난 집중을 시작 순으로 세어 찾는다 (QA #27)
      const m = id.match(/^today:(\d+)$/)
      let s = m ? undefined : await db.focusSessions.get(id)
      if (m) {
        const [a, b] = studyDayRange(new Date())
        const list = (await db.focusSessions.where('startedAt').between(a, b).filter((x) => x.completed).toArray()).sort((x, y) => x.startedAt - y.startedAt)
        s = list[Number(m[1])] ?? list[list.length - 1]
      }
      if (!s) return null
      const note = s.subjectId ? (await db.notes.where('subjectId').equals(s.subjectId).reverse().sortBy('updatedAt'))[0] : undefined
      return {
        id,
        title: await subjectName(s.subjectId),
        meta: `${fmtMD(s.startedAt)} ${fmtHM(s.startedAt)} · ${Math.round((s.endedAt - s.startedAt) / MIN)}분`,
        chips: [await subjectDot(s.subjectId), { kind: 'num', text: fmtMD(s.startedAt), tip: fmtHM(s.startedAt) }, { kind: 'focus', text: `${Math.round((s.endedAt - s.startedAt) / MIN)}:00`, tip: '집중' }],
        action: note ? { icon: 'note', label: '노트 열기', run: (el) => { ui.setNoteFocusId(note.id); goTo('/notes', el) } } : null,
        zoom: (z) => z * 2.4,
      }
    }
    if (layer === 'exam') {
      const t = await db.tasks.get(id)
      if (!t) return null
      const scope = await db.cards.where('examId').equals(id).count()
      return {
        id,
        title: t.title,
        meta: `${fmtMD(t.dueAt)} · ${fmtDday(ddayOf(new Date(), t.dueAt))}${scope ? ` · 범위 ${scope}` : ''}`,
        chips: [{ kind: 'dot', color: 'var(--seal)', tip: '시험' }, { kind: 'num', text: fmtMD(t.dueAt) }, { kind: 'num', text: fmtDday(ddayOf(new Date(), t.dueAt)) }, ...(scope ? [{ kind: 'review' as const, text: `${scope}`, tip: '범위' }] : [])],
        action: { icon: 'review', label: '범위 복습', run: (el) => { ui.setReviewIntent(true); goTo('/review', el) } },
        zoom: (z) => z * 2.4,
      }
    }
    if (layer === 'review') {
      const c = await db.cards.get(id)
      if (!c) return null
      const [, end] = studyDayRange(Date.now())
      const days = Math.ceil((c.due - end) / 86_400_000)
      return {
        id,
        title: c.front,
        meta: `${await subjectName(c.subjectId)} · ${c.due < end ? '오늘' : days <= 1 ? '내일 다시' : `${days}일 뒤`}`,
        chips: [await subjectDot(c.subjectId), { kind: 'review', text: fmtMD(c.due), tip: c.due < end ? '오늘' : days <= 1 ? '내일 다시' : `${days}일 뒤` }],
        action: { icon: 'review', label: '이 카드 복습', run: (el) => { ui.setReviewIntent(true); goTo('/review', el) } },
        zoom: () => 3.0,
      }
    }
    if (layer === 'graph') {
      const n = graphNodeInfo(id)
      if (!n) return null
      return {
        id,
        title: n.label,
        meta: `${await subjectName(n.subject)} · 링크 ${n.links}`,
        chips: [await subjectDot(n.subject), { kind: 'link', text: `${n.links}`, tip: '링크' }],
        action: { icon: 'arrow', label: '열기', run: (el) => goTo('/notes', el) },
        zoom: () => 3.4,
      }
    }
    // M2: 지도의 노트 별 (useSkyStars notes 층) — 누르면 그 노트를 연다
    if (layer === 'notes') {
      const note = await db.notes.get(id)
      if (!note || note.deletedAt) return null
      const links = (await db.links.where('from').equals(id).count()) + (await db.links.where('to').equals(id).count())
      return {
        id,
        title: note.title || fmtMD(note.createdAt),
        meta: `${await subjectName(note.subjectId)} · 링크 ${links}`,
        chips: [await subjectDot(note.subjectId), { kind: 'link', text: `${links}`, tip: '링크' }],
        action: { icon: 'arrow', label: '열기', run: (el) => { ui.setNoteFocusId(note.id); goTo('/notes', el) } },
        zoom: () => 3.4,
      }
    }
    return null
  }

  const close = () => {
    if (!infoRef.current) return
    setInfo(null)
    sky.select(null)
    const h = home.current
    home.current = null
    if (hops.current > 1 && h) void cam.flyTo(h)
    else void cam.back()
    hops.current = 0
  }

  // 누르기 · Esc
  useEffect(() => {
    const onClick = async (e: MouseEvent) => {
      if (isDragClick(e)) return // 끌기의 끝: 닫지도 고르지도 않는다
      if (e.defaultPrevented || e.button !== 0 || useUi.getState().paletteOpen) return
      const t = e.target as Element | null
      if (t?.closest?.(INTERACTIVE)) return
      const touch = (e as PointerEvent).pointerType === 'touch'
      const hit = pick(e.clientX, e.clientY, touch ? 22 : 14)
      if (!hit) {
        close()
        return
      }
      const next = await resolve(hit.id, hit.layer)
      if (!next) return
      if (!infoRef.current) {
        home.current = { ...cam.current }
        hops.current = 0
      }
      hops.current++
      const z0 = home.current?.zoom ?? cam.current.zoom ?? 1
      setInfo(next)
      sky.select(next.id)
      void cam.flyTo({ scene: cam.current.scene, focus: hit.sky, zoom: Math.min(z0 * 3.5, next.zoom(z0)) })
      requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    }
    // Esc는 겹침 층 관리자(src/shell/layers.ts)가 맨 위 층만 닫는다 — 여기서 window 캡처로 먼저 받지 않는다(QA #2–#4)
    // 하늘을 끌어도 포커스는 패널에 남긴다(QA #15): 끌기가 포커스를 body·#stage로 빼면 패널로 되돌린다
    const onUp = () => {
      if (!infoRef.current) return
      requestAnimationFrame(() => {
        const a = document.activeElement
        if (infoRef.current && (!a || a === document.body || (a as HTMLElement).id === 'stage' || a.tagName === 'CANVAS')) panelRef.current?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('click', onClick)
    window.addEventListener('pointerup', onUp, true)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('pointerup', onUp, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, isDragClick, cam, sky])

  // 포인터가 별 위에 있으면 커서 (rAF로 한 프레임에 한 번)
  useEffect(() => {
    let raf = 0
    let last: PointerEvent | null = null
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      // 종이가 펼쳐졌거나 쓰는 중이면 하늘 판정을 하지 않는다 (펜 이동마다 rAF를 걸지 않게 — 전력)
      const root = document.documentElement
      if ('paper' in root.dataset || root.hasAttribute('data-inking') || e.buttons !== 0) return
      last = e
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const ev = last
        if (!ev) return
        const over = !(ev.target as Element | null)?.closest?.(INTERACTIVE) && !!pick(ev.clientX, ev.clientY, 14)
        document.documentElement.classList.toggle('star-hover', over)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [pick])

  // 공간을 옮기면 조용히 닫는다(그 공간으로의 비행이 이어 받는다)
  useEffect(() => {
    if (!infoRef.current) return
    setInfo(null)
    sky.select(null)
    home.current = null
    hops.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    const root = document.documentElement
    if (info) root.dataset.starOpen = '1'
    else delete root.dataset.starOpen
  }, [info])

  if (!info) return null
  return (
    <>
    <StarLayer close={close} panelRef={panelRef} />
    <div ref={panelRef} className="star-info" data-zone-place={path} role="dialog" aria-label={info.title} tabIndex={-1} key={info.id}>
      <h2 className="focus-lines star-title">{info.title}</h2>
      <p className="star-chips" aria-label={info.meta}>
        {info.chips.map((c, i) =>
          c.kind === 'dot' ? (
            <i key={i} className={`sdot is-lg${c.color ? '' : ' is-none'}`} style={c.color ? { ['--c' as string]: c.color } : undefined} {...(c.tip ? tip(c.tip) : {})} aria-hidden="true" />
          ) : (
            <span key={i} className="inum" aria-hidden="true" {...(c.tip ? { 'data-tip': c.tip } : {})}>
              {c.kind === 'link' && <IconLink size={14} />}
              {c.kind === 'review' && <IconReview size={14} />}
              {c.kind === 'focus' && <IconFocus size={14} />}
              {c.text}
            </span>
          ),
        )}
      </p>
      <div className="actions">
        {info.action && (
          <button type="button" className="gold-btn" {...tip(info.action.label)} onClick={(e) => info.action!.run(e.currentTarget)}>
            {info.action.icon === 'note' ? <IconNote size={24} /> : info.action.icon === 'review' ? <IconReview size={24} /> : <IconArrow size={24} />}
          </button>
        )}
        <button type="button" className="icon-btn ghost" {...tip('닫기', { kbd: 'esc' })} onClick={close}>
          <IconClose size={18} />
        </button>
      </div>
    </div>
    </>
  )
}

/** 별 패널이 떠 있는 동안 겹침 층 하나 (Esc = 맨 위 층만) */
function StarLayer({ close, panelRef }: { close: () => void; panelRef: RefObject<HTMLDivElement | null> }) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => pushLayer({ id: 'star', close: () => ref.current(), el: panelRef.current }), [panelRef])
  return null
}
