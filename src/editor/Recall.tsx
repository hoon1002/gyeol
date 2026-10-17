/**
 * 떠올리기 모드 (design-m4 3장 · 앱 A, 지연 조각). 글 0줄 — 제목만 데이터.
 *   ① 가리기: 본문이 종이색 안개로 덮인다(위 → 아래 320ms) ② 쓰기: 같은 자리가 빈 칸(⌘Enter · 금빛 ✓ = 다 썼음, 안개를 길게 = 1초 엿보기)
 *   ③ 비교: 내 글 · 원문 나란히. 빠진 문장 = --text-1 + 왼쪽 금 막대(판정은 src/memory/recall.ts, RECALL_MISS 0.35)
 *   ④ 빠진 곳을 누르면 점선 + 후보 표시 → ✓로 후보(규칙 'recall')가 된다. 필기 노트는 원문 쪽에서 끌어 영역을 고른다.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react'
import { useSkyEvent } from '@/fx'
import { db, type Note } from '@/db/schema'
import { IconCandidate, IconCheck, IconClose, IconNote, IconRecall } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { Hint } from '@/shell/Hint'
import { pushLayer } from '@/shell/layers'
import { compareRecall } from '@/memory/recall'
import { addRecallCandidates } from '@/memory/candidates'
import { hashText } from '@/memory/extract'
import '@/styles/memory.css'

type PM = { type: string; text?: string; content?: PM[]; marks?: Array<{ type: string }>; attrs?: Record<string, unknown> }
type Rect = [number, number, number, number]
type InkPage = { id: string; w: number; h: number; url: string }

const H12_ART = (
  <svg width="96" height="56" viewBox="0 0 96 56" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
    <path d="M10 14h26M10 22h22M10 30h24" opacity=".35" />
    <rect x="6" y="8" width="34" height="30" rx="4" fill="currentColor" opacity=".12" stroke="none" />
    <path d="M48 36l14-14 4 4-14 14h-4z" />
    <rect x="58" y="10" width="14" height="30" rx="2" opacity=".6" />
    <rect x="76" y="10" width="14" height="30" rx="2" opacity=".6" />
  </svg>
)

/** 굵은 글씨 · [[링크]] 낱말 — 빠지면 늘 빠짐 */
function mustWords(doc: unknown): string[] {
  const out: string[] = []
  const walk = (n: PM) => {
    if (n.type === 'text' && n.text && n.marks?.some((m) => m.type === 'bold')) out.push(n.text.trim())
    if (n.type === 'noteLink' && typeof n.attrs?.title === 'string') out.push(String(n.attrs.title).trim())
    n.content?.forEach(walk)
  }
  if (doc && typeof doc === 'object') walk(doc as PM)
  return [...new Set(out.filter((w) => w.length >= 2))]
}

const PARTICLE = /(에서|으로|이란|란|은|는|이|가|을|를|의|에|로|와|과|도|만)$/
/** 빠진 문장 → 카드 한 장: 굵은 · 링크 낱말이 있으면 그 빈칸, 아니면 가장 긴 낱말 빈칸(조사 떼기). 후보함에서 고칠 수 있다 */
export function sentenceCard(s: string, must: string[]): { front: string; back: string } {
  const w = must.find((m) => s.includes(m))
  if (w) return { front: s.replace(w, '[…]'), back: w }
  const words = (s.match(/[\p{L}\p{N}]{2,}/gu) ?? []).map((t) => (t.length >= 3 && t.replace(PARTICLE, '').length >= 2 ? t.replace(PARTICLE, '') : t)).filter((t) => t.length >= 2)
  const best = words.sort((a, b) => b.length - a.length)[0]
  return best ? { front: s.replace(best, '[…]'), back: best } : { front: s, back: s }
}

export default function Recall({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const [note, setNote] = useState<Note | null>(null)
  const [orig, setOrig] = useState<{ text: string; must: string[] } | null>(null)
  const [pages, setPages] = useState<InkPage[] | null>(null)
  const [step, setStep] = useState<'write' | 'compare'>('write')
  const [mine, setMine] = useState('')
  const [peek, setPeek] = useState(false)
  const [picks, setPicks] = useState<Set<number>>(new Set())
  const [rects, setRects] = useState<Array<{ pageId: string; r: Rect }>>([])
  const [show, setShow] = useState<'mine' | 'orig'>('orig')
  const peeks = useRef(0)
  const writeRef = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLElement>(null)
  const sky = useSkyEvent()
  const ink = note?.kind === 'ink' || note?.kind === 'pdf'

  useEffect(() => {
    let alive = true
    void (async () => {
      const n = await db.notes.get(noteId)
      if (!alive) return
      if (!n) return onClose()
      setNote(n)
      if (n.kind === 'ink' || n.kind === 'pdf') {
        const ps = (await db.pages.where('noteId').equals(noteId).sortBy('index')).filter((p) => !p.deletedAt)
        const m = await import('@/ink')
        const out: InkPage[] = []
        for (const p of ps.slice(0, 12)) {
          const img = await m.renderPageRegion(p.id, [0, 0, p.w, p.h], { covered: false, scale: 1.5, night: document.documentElement.dataset.theme !== 'light', margin: [0, 0] }).catch(() => null)
          if (img) out.push({ id: p.id, w: p.w, h: p.h, url: img.url })
        }
        if (alive) setPages(out)
      } else {
        const b = await db.noteBodies.get(noteId)
        // 빈칸 표기 {{x}}는 글만 남기고, 그 낱말도 늘 검사한다
        const raw = b?.text ?? ''
        const cloze = [...raw.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]!.trim())
        if (alive) setOrig({ text: raw.replace(/\{\{([^}]+)\}\}/g, '$1'), must: [...new Set([...mustWords(b?.doc), ...cloze])] })
      }
    })()
    return () => {
      alive = false
    }
  }, [noteId, onClose])

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => pushLayer({ id: 'recall', el: box.current, restoreFocusTo: null, close: () => closeRef.current() }), [])

  const lines = useMemo(() => (orig && step === 'compare' ? compareRecall(orig.text, mine, orig.must) : []), [orig, mine, step])
  // 빠진 문장은 처음부터 골라 둔다(누르면 취소)
  useEffect(() => {
    if (step === 'compare') setPicks(new Set(lines.map((l, i) => (l.missing ? i : -1)).filter((i) => i >= 0)))
  }, [step, lines])
  const missing = lines.filter((l) => l.missing).length

  const toCompare = () => {
    setStep('compare')
    setShow('orig')
  }
  const finish = async () => {
    const items = ink
      ? rects.map(({ pageId, r }) => ({ front: '', back: '', anchor: `region:${pageId}:${r.map((v) => Math.round(v)).join(',')}` }))
      : [...picks].sort((a, b) => a - b).map((i) => {
          const s = lines[i]!.text
          return { ...sentenceCard(s, orig?.must ?? []), anchor: `recall:${hashText(s)}` }
        })
    if (items.length) await addRecallCandidates(noteId, items)
    // 시험 계획의 '떠올리기 1번' (앱 B가 읽을 수 있게 meta에 남긴다) · 엿본 횟수는 기록만
    try {
      const k = 'recall.log'
      const prev = ((await db.meta.get(k))?.value as Array<{ noteId: string; at: number; peeks: number; picked: number }> | undefined) ?? []
      await db.meta.put({ key: k, value: [...prev.slice(-199), { noteId, at: Date.now(), peeks: peeks.current, picked: items.length }] })
    } catch {
      /* 기록 실패는 조용히 */
    }
    sky.inkSettled(noteId)
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (step === 'write') toCompare()
      else void finish()
    }
  }

  // 안개를 길게 누르면 1초 엿보기
  const peekTimer = useRef(0)
  const peekDown = (e: RPE) => {
    if (e.button !== 0 || step !== 'write') return
    const x = e.clientX
    const y = e.clientY
    window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => {
      peeks.current++
      setPeek(true)
      window.setTimeout(() => setPeek(false), 1000)
    }, 600)
    const move = (m: PointerEvent) => Math.hypot(m.clientX - x, m.clientY - y) > 8 && cancel()
    const cancel = () => {
      window.clearTimeout(peekTimer.current)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cancel)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cancel)
  }

  const ready = note ? (ink ? !!pages : !!orig) : false
  // 열면 쓰기 칸에 포커스 (준비되기 전엔 disabled라 autoFocus가 듣지 않는다 — QA M4 #5)
  useEffect(() => {
    if (ready && step === 'write') writeRef.current?.focus({ preventScroll: true })
  }, [ready, step])
  if (!note) return null
  return (
    <section className={`rc${step === 'compare' ? ' is-cmp' : ''}`} ref={box} tabIndex={-1} aria-label="떠올리기" onKeyDown={onKey}>
      <header className="rc-head">
        <button type="button" className="ibtn" {...tip('닫기', { kbd: 'esc' })} onClick={onClose}>
          <IconClose size={18} />
        </button>
        <span className="rc-title">{note.title || '제목 없음'}</span>
        {step === 'compare' && (
          <span className="rc-seg" role="tablist">
            <button type="button" role="tab" aria-selected={show === 'mine'} className={`ibtn${show === 'mine' ? ' is-on' : ''}`} {...tip('내 글')} onClick={() => setShow('mine')}>
              <IconRecall size={16} />
            </button>
            <button type="button" role="tab" aria-selected={show === 'orig'} className={`ibtn${show === 'orig' ? ' is-on' : ''}`} {...tip('원문')} onClick={() => setShow('orig')}>
              <IconNote size={16} />
              {!ink && missing > 0 && <span className="mono">{missing}</span>}
            </button>
          </span>
        )}
        <span aria-hidden="true" style={{ position: 'relative' }}>
          <Hint id="H12" side="bottom" art={H12_ART} />
        </span>
      </header>
      <div className="rc-main" onPointerDown={peekDown}>
        {step === 'write' ? (
          <>
            {peek && (
              <div className="rc-peek" aria-hidden="true">
                {ink ? pages?.[0] && <img src={pages[0].url} alt="" style={{ width: '100%' }} /> : orig?.text}
              </div>
            )}
            <div className={`rc-fog${peek ? ' is-peek' : ''}`} aria-hidden="true" />
            <textarea ref={writeRef} className="rc-write" value={mine} onChange={(e) => setMine(e.target.value)} aria-label="기억나는 것" autoFocus disabled={!ready} style={peek ? { opacity: 0 } : undefined} />
          </>
        ) : (
          <div className="rc-cols" data-show={show}>
            <div className="rc-col rc-mine-out">{mine}</div>
            <div className="rc-col rc-orig">
              {ink
                ? pages?.map((p) => <PagePick key={p.id} page={p} rects={rects.filter((r) => r.pageId === p.id).map((r) => r.r)} onChange={(rs) => setRects((all) => [...all.filter((r) => r.pageId !== p.id), ...rs.map((r) => ({ pageId: p.id, r }))])} />)
                : lines.map((l, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`rc-s${l.missing ? ' is-miss' : ''}${picks.has(i) ? ' is-pick' : ''}`}
                      aria-pressed={picks.has(i)}
                      onClick={() =>
                        setPicks((s) => {
                          const n = new Set(s)
                          if (n.has(i)) n.delete(i)
                          else n.add(i)
                          return n
                        })
                      }
                    >
                      {picks.has(i) && (
                        <span className="rc-pick-ico" aria-label="후보로">
                          <IconCandidate size={14} />
                        </span>
                      )}
                      {l.text}
                    </button>
                  ))}
            </div>
          </div>
        )}
      </div>
      <footer className="rc-foot">
        {step === 'write' ? (
          <button type="button" className="gold-btn" {...tip('다 썼음', { kbd: '⌘↵' })} onClick={toCompare} disabled={!ready}>
            <IconCheck size={22} />
          </button>
        ) : (
          <button type="button" className="gold-btn" {...tip(ink ? `후보로 ${rects.length}` : `후보로 ${picks.size}`, { kbd: '⌘↵' })} onClick={() => void finish()}>
            <IconCheck size={22} />
          </button>
        )}
      </footer>
    </section>
  )
}

/** 필기 원문 쪽: 끌어서 영역 고르기(올가미 대신 사각형), 고른 영역을 누르면 취소 */
function PagePick({ page, rects, onChange }: { page: InkPage; rects: Rect[]; onChange: (r: Rect[]) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Rect | null>(null)
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const b = el.current!.getBoundingClientRect()
    return [((e.clientX - b.left) / b.width) * page.w, ((e.clientY - b.top) / b.height) * page.h]
  }
  const down = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const [x, y] = at(e)
    const hit = rects.findIndex((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3])
    if (hit >= 0) return onChange(rects.filter((_, i) => i !== hit))
    el.current!.setPointerCapture(e.pointerId)
    setDraft([x, y, x, y])
  }
  const move = (e: RPE<HTMLDivElement>) => {
    if (!draft) return
    const [x, y] = at(e)
    setDraft([draft[0], draft[1], x, y])
  }
  const up = () => {
    if (!draft) return
    const r: Rect = [Math.min(draft[0], draft[2]), Math.min(draft[1], draft[3]), Math.max(draft[0], draft[2]), Math.max(draft[1], draft[3])]
    setDraft(null)
    if (r[2] - r[0] > 12 && r[3] - r[1] > 8) onChange([...rects, r])
  }
  const style = (r: Rect) => ({ left: `${(Math.min(r[0], r[2]) / page.w) * 100}%`, top: `${(Math.min(r[1], r[3]) / page.h) * 100}%`, width: `${(Math.abs(r[2] - r[0]) / page.w) * 100}%`, height: `${(Math.abs(r[3] - r[1]) / page.h) * 100}%` })
  return (
    <div className="rc-page" ref={el} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDraft(null)}>
      <img src={page.url} alt="" draggable={false} />
      {rects.map((r, i) => (
        <span key={i} className="rc-rect" style={style(r)}>
          <span className="rc-pick-ico">
            <IconCandidate size={14} />
          </span>
        </span>
      ))}
      {draft && <span className="rc-rect" style={style(draft)} />}
    </div>
  )
}
