/**
 * 별 누르기 (design-v3-camera §3): 데이터 별(오늘의 별·시험 별·복습 별·그래프 별)을 누르면
 * useSkyPick으로 찾고 useSkyCamera.flyTo로 그 별을 '별 좌석'에 앉힌다. 왼쪽 글자 구역엔 명사구 / 메타 / 동작 하나.
 * 닫기(× · Esc · 빈 하늘 누르기) = back(). 별 안에서 다른 별을 누르면 옆으로 날아간다.
 * 비행 중 누름은 엔진 규칙대로(무시/도착 뒤 처리). 포인터가 별 위에 있으면 커서가 바뀐다.
 */
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useSkyCamera, useSkyEvent, useSkyPick, type CameraTarget } from '@/fx'
import { db } from '@/db/schema'
import { graphNodeInfo } from '@/lib/graph'
import { ddayOf, fmtDday, fmtHM, fmtMD, MIN, studyDayRange } from '@/lib/time'
import { useUi } from '@/stores/ui'
import { useGo } from './hooks'
import { IconClose } from './icons'
import type { SpacePath } from './spaces'

interface StarInfo {
  id: string
  title: string
  meta: string
  action: { label: string; run: (el: Element | null) => void } | null
  zoom: (z: number) => number
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="dialog"], [role="button"], .dock, .topbar, .palette, .sheet-layer, .star-info, .flash, .week-grid, .cont, .recent'

export function StarPress() {
  const { pick } = useSkyPick()
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
      const s = await db.focusSessions.get(id)
      if (!s) return null
      const note = s.subjectId ? (await db.notes.where('subjectId').equals(s.subjectId).reverse().sortBy('updatedAt'))[0] : undefined
      return {
        id,
        title: await subjectName(s.subjectId),
        meta: `${fmtMD(s.startedAt)} ${fmtHM(s.startedAt)} · ${Math.round((s.endedAt - s.startedAt) / MIN)}분`,
        action: note ? { label: '노트 열기', run: (el) => { ui.setNoteFocusId(note.id); goTo('/notes', el) } } : null,
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
        action: { label: '범위 복습', run: (el) => { ui.setReviewIntent(true); goTo('/review', el) } },
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
        action: { label: '이 카드 복습', run: (el) => { ui.setReviewIntent(true); goTo('/review', el) } },
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
        action: { label: '열기', run: (el) => goTo('/notes', el) },
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && infoRef.current) {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, cam, sky])

  // 포인터가 별 위에 있으면 커서 (rAF로 한 프레임에 한 번)
  useEffect(() => {
    let raf = 0
    let last: PointerEvent | null = null
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
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
    <div ref={panelRef} className="star-info" data-zone-place={path} role="dialog" aria-label={info.title} tabIndex={-1} key={info.id}>
      <h2 className="focus-lines star-title">{info.title}</h2>
      <p className="meta">{info.meta}</p>
      <div className="actions">
        {info.action && (
          <button type="button" className="btn-primary" onClick={(e) => info.action!.run(e.currentTarget)}>
            <span>{info.action.label}</span>
          </button>
        )}
        <button type="button" className="icon-btn ghost" aria-label="닫기" onClick={close}>
          <IconClose size={18} />
        </button>
      </div>
    </div>
  )
}
