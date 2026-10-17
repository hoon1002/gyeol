/**
 * 테이프 카드 뒤집기 (design-m4 1-6): 크로스페이드 대신 테이프가 걷힌다 — 누른 점에서 가까운 끝부터 260ms clip-path + 별빛 점 3개.
 * 뒷면의 테이프 자리 점선(45%)은 1.2초 뒤 20%로. 하늘은 깨우지 않는다(카드 안 DOM만).
 *
 *   <TapeReveal itemId={card.source.itemId} covered={!flipped} onReveal={() => setFlipped(true)} />
 *   covered: true = 덮음(앞면) · false = 걷음(뒷면). 누르면 onReveal (상태는 앱이 바꾼다)
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { renderTapeRegion, type RegionImage } from './region'
import { tapePath } from './items'
import type { InkDB } from '@/db/ink'

export interface TapeRevealProps {
  itemId: string
  covered: boolean
  onReveal?: () => void
  /** 그림 배율 (기본 기기 배율, 최소 2) */
  scale?: number
  night?: boolean
  db?: InkDB
  className?: string
  style?: CSSProperties
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function TapeReveal(p: TapeRevealProps) {
  const [front, setFront] = useState<RegionImage | null>(null)
  const [back, setBack] = useState<RegionImage | null>(null)
  const faceRef = useRef<HTMLImageElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const side = useRef<{ fromLeft: boolean; x: number; y: number } | null>(null)
  const [dim, setDim] = useState(false)
  const prev = useRef(p.covered)
  const scale = p.scale ?? Math.max(2, window.devicePixelRatio || 1)

  useEffect(() => {
    let dead = false
    void Promise.all([renderTapeRegion(p.itemId, { covered: true, scale, night: p.night, db: p.db }), renderTapeRegion(p.itemId, { covered: false, scale, night: p.night, db: p.db })]).then(([a, b]) => {
      if (dead) return
      setFront(a)
      setBack(b)
    })
    return () => {
      dead = true
    }
  }, [p.itemId, scale, p.night, p.db])

  // 덮음 → 걷음: 누른 점에서 가까운 끝부터 걷힌다
  useEffect(() => {
    const was = prev.current
    prev.current = p.covered
    const face = faceRef.current
    if (!face || was === p.covered) return
    setDim(false)
    if (!p.covered) {
      const t = window.setTimeout(() => setDim(true), 1200)
      if (reduced()) {
        face.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })
        return () => clearTimeout(t)
      }
      const fromLeft = side.current?.fromLeft ?? true
      face.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: fromLeft ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' })
      const box = boxRef.current
      const at = side.current
      if (box && at) {
        const night = p.night ?? document.documentElement.getAttribute('data-theme') !== 'light'
        for (let i = 0; i < 3; i++) {
          const dot = document.createElement('i')
          const a = (i * Math.PI * 2) / 3 + (p.itemId.charCodeAt(i % p.itemId.length) % 60) * 0.02
          const d = 6 + (i * 2)
          dot.style.cssText = `position:absolute;left:${at.x}px;top:${at.y}px;width:1.5px;height:1.5px;border-radius:50%;pointer-events:none;background:${night ? '#F3D29A' : '#7A5714'}`
          box.appendChild(dot)
          dot.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px))`, opacity: 0 }], { duration: 400, delay: 50, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }).onfinish = () => dot.remove()
        }
      }
      return () => clearTimeout(t)
    }
    face.getAnimations().forEach((a) => a.cancel())
    face.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: reduced() ? 0 : 180, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' })
  }, [p.covered, p.itemId, p.night])

  const img = front ?? back
  const tp = back?.tape
  return (
    <div
      ref={boxRef}
      className={p.className}
      style={{ position: 'relative', width: '100%', aspectRatio: img ? `${img.w} / ${img.h}` : undefined, overflow: 'hidden', ...p.style }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - r.left, y = e.clientY - r.top
        side.current = { fromLeft: x < r.width / 2, x, y }
      }}
      onClick={() => p.covered && p.onReveal?.()}
      role={p.covered ? 'button' : undefined}
      aria-label={p.covered ? '걷기' : undefined}
    >
      {back && <img src={back.url} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
      {tp && back && (
        <svg viewBox={`0 0 ${back.w} ${back.h}`} preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: p.covered ? 0 : dim ? 0.2 / 0.45 : 1, transition: 'opacity 600ms', pointerEvents: 'none' }}>
          <path d={tapePath(tp.id, tp.w, tp.h)} transform={`translate(${tp.x + tp.w / 2} ${tp.y + tp.h / 2}) rotate(${(tp.rot * 180) / Math.PI}) translate(${-tp.w / 2} ${-tp.h / 2})`} fill="none" stroke={tp.color} strokeOpacity={0.45} strokeWidth={0.75} strokeDasharray="3 3" />
        </svg>
      )}
      {front && <img ref={faceRef} src={front.url} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', clipPath: p.covered ? 'inset(0 0 0 0)' : 'inset(0 0 0 100%)' }} />}
    </div>
  )
}

export default TapeReveal
