/**
 * 종이 펼치기 (design-ink 1장 · 리더 M3 2단계): 필기 · PDF 노트를 열면 종이가 화면을 덮고,
 * 레일 · 위 크롬 · 노트 목록은 비켜난다(:root[data-paper], useSkyPaper — 하늘 띠는 밖으로, 쉼).
 * 쓰는 동안의 하늘 쉼(useFieldPause 'ink')과 :root[data-inking]은 엔진 래퍼(InkSurface)가 한다.
 *
 * 닫기: 왼쪽 위 ‹ · Esc(겹침 층 — 고른 것이 있으면 그것부터 풀기) · ⌘K '노트 닫기'(엔진 ui 'ink.close').
 * 닫으면 이번에 획이 늘었을 때 하늘 inkSettled(noteId, { pages }) (잉크가 별이 된다, K1).
 * 여는 전환 중 펜이 닿으면 전환을 최종 상태로 건너뛰어 첫 점을 살린다(design-ink 1-8).
 * 목록 줄 썸네일: 첫 쪽 그림을 엔진 thumbnail()로 찍어 meta 'ink.thumb.<noteId>'에 둔다(쓰고 쉴 때 · 닫을 때).
 */
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useSkyEvent, useSkyPaper } from '@/fx'
import { db, type Note, type PageTemplate } from '@/db/schema'
import type { InkEngine } from '@/ink'
import { useLiveQuery } from 'dexie-react-hooks'
import { IconBack, IconRecall } from '@/shell/icons'
import { openRecall, recallReady } from './recallState'
import { PaperCands } from './PaperCands'
import { pushLayer } from '@/shell/layers'
import { tip } from '@/shell/Tip'
import { paperClosed, paperOpened, takePendingPdf } from './inkState'
import '@/styles/paper.css'

const InkSurface = lazy(() => import('@/ink'))

/** 잉크 화면이 무너져도 앱 전체(라우트)를 끌고 가지 않게: 종이만 비우고 ‹로 닫을 수 있게 둔다 */
class InkGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[ink] 종이를 그리지 못함', err)
  }
  render() {
    return this.state.failed ? <p className="ink-sheet-err">이 노트를 열 수 없어요.</p> : this.props.children
  }
}

export interface InkSheetProps {
  note: Note
  /** 새 노트 첫 쪽 틀 */
  template?: PageTemplate
  /** 출발 사각형(누른 목록 줄). 없으면 화면 가운데에서 */
  origin?: { x: number; y: number } | null
  active: boolean
  onClose: () => void
}

export const THUMB_KEY = (noteId: string) => 'ink.thumb.' + noteId

async function captureThumb(eng: InkEngine, noteId: string): Promise<void> {
  try {
    const first = eng.doc.pages[0]?.page.id
    if (!first) return
    const c = await eng.thumbnail(first, 96)
    if (!c || !c.width) return
    await db.meta.put({ key: THUMB_KEY(noteId), value: { url: c.toDataURL('image/png'), at: Date.now() } })
  } catch {
    /* 썸네일은 덤 — 실패해도 노트는 그대로 */
  }
}

export default function InkSheet({ note, template, origin, active, onClose }: InkSheetProps) {
  const sky = useSkyEvent()
  const sheetRef = useRef<HTMLDivElement>(null)
  const engRef = useRef<InkEngine | null>(null)
  const [phase, setPhase] = useState<'in' | 'open' | 'out'>('in')
  const closing = useRef(false)
  useSkyPaper(active && phase !== 'out')

  useEffect(() => {
    paperOpened(note.id)
    return () => paperClosed(note.id)
  }, [note.id])

  // 여는 전환: 다음 프레임에 펼침(transform · opacity만)
  useEffect(() => {
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setPhase((p) => (p === 'in' ? 'open' : p))))
    return () => cancelAnimationFrame(r)
  }, [])

  const close = useCallback(async () => {
    if (closing.current) return
    closing.current = true
    const eng = engRef.current
    // 썸네일은 길어야 0.15초만 기다린다(닫기가 먼저)
    if (eng) await Promise.race([captureThumb(eng, note.id), new Promise((r) => setTimeout(r, 150))])
    setPhase('out')
    window.setTimeout(onClose, 200)
  }, [note.id, onClose])

  // 겹침 층: Esc = 고른 것이 있으면 그것부터 풀고(층은 남김), 없으면 노트를 닫는다
  useEffect(
    () =>
      pushLayer({
        id: 'ink-note',
        close: () => {
          const e = engRef.current
          if (e?.sel) {
            e.clearSelection()
            return false
          }
          void close()
        },
        el: sheetRef.current,
      }),
    [close],
  )

  // 전환 중 펜이 닿으면 최종 상태로 건너뛰고 그 점을 엔진에 그대로 준다(캡처 단계에서 transform을 먼저 없앤다)
  const onPointerDownCapture = (e: ReactPointerEvent) => {
    if (phase === 'in' || sheetRef.current?.classList.contains('is-moving')) {
      const el = sheetRef.current
      if (el) {
        el.classList.add('is-snap')
        void el.offsetWidth // 레이아웃을 지금 확정(엔진이 이 좌표로 첫 점을 잡는다)
      }
      setPhase('open')
    }
    if (phase === 'out') e.stopPropagation()
  }

  const onReady = (eng: InkEngine) => {
    engRef.current = eng
    const pdf = takePendingPdf(note.id)
    if (pdf)
      void eng.importPdf(pdf).then(async () => {
        // 가져오기가 끝나면 남은 빈 쪽(PDF 아님 · 획 · 물건 없음)을 지운다(QA #24)
        for (const pm of [...eng.doc.pages]) {
          if (pm.page.pdf) continue
          await eng.doc.load(pm)
          if (pm.strokes.size === 0 && pm.items.size === 0) eng.deletePage(pm.page.id)
        }
        await captureThumb(eng, note.id)
      })
    // 첫 쪽이 바뀌고 쉬면(엔진이 1초 디바운스해서 'thumb'을 낸다) 목록 썸네일을 새로
    eng.on('thumb', ({ pageId }) => {
      if (pageId === eng.doc.pages[0]?.page.id) void captureThumb(eng, note.id)
    })
    // 맞춤 배율에서 두 손가락을 더 오므렸다 떼면 종이를 닫는다(엔진: 맞춤의 85% 아래)
    eng.on('pinchclose', () => void close())
  }

  const style = origin ? { transformOrigin: `${origin.x}px ${origin.y}px` } : undefined
  return (
    <div
      ref={sheetRef}
      className={`ink-sheet is-${phase}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={note.title.trim() || '필기'}
      onPointerDownCapture={onPointerDownCapture}
      onTransitionStart={(e) => e.target === sheetRef.current && sheetRef.current?.classList.add('is-moving')}
      onTransitionEnd={(e) => e.target === sheetRef.current && sheetRef.current?.classList.remove('is-moving')}
    >
      <InkGuard>
      <Suspense fallback={<div className="ink-sheet-wait" aria-hidden="true" />}>
        <InkSurface
          noteId={note.id}
          template={template}
          active={active}
          onReady={onReady}
          onClose={() => void close()}
          onPagesWritten={(pages, strokes) => {
            if (strokes > 0) sky.inkSettled(note.id, { pages: Math.max(1, pages) })
          }}
        />
      </Suspense>
      </InkGuard>
      <button type="button" className="ibtn ink-sheet-back" {...tip('노트 목록', { kbd: 'esc', side: 'right' })} onClick={() => void close()}>
        <IconBack size={22} />
      </button>
      <InkMem noteId={note.id} />
    </div>
  )
}

/** 종이 머리(M4): 이 노트의 후보 수(있을 때만) · 떠올리기(쪽이 1장 이상일 때만) */
function InkMem({ noteId }: { noteId: string }) {
  const cands = useLiveQuery(() => db.cardCandidates.where('noteId').equals(noteId).filter((c) => c.status === 'new').count(), [noteId]) ?? 0
  // 떠올리기는 쓴 것(획 · 글 상자)이 있을 때만 (빈 쪽만 있는 새 필기 노트는 숨김)
  const ready = useLiveQuery(() => recallReady(noteId), [noteId]) ?? false
  if (!cands && !ready) return null
  return (
    <span className="ink-sheet-mem">
      {cands > 0 && <PaperCands noteId={noteId} n={cands} />}
      {ready && (
        <button type="button" className="ibtn np-mini" {...tip('떠올리기', { kbd: '⌥R', side: 'right' })} onClick={() => openRecall(noteId)}>
          <IconRecall size={16} />
        </button>
      )}
    </span>
  )
}
