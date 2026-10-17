/**
 * 첫 회 안내 그림 (design-quiet 4-2, H1–H10). 64–96px 선 그림, 2.4초 × 2번 돌고 멈춘다(동작 줄이기면 마지막 프레임).
 *
 *   <div style={{ position: 'relative' }}>
 *     <button …/>
 *     <Hint id="H7" side="top" />          — 부모(대상 둘레)를 누르면 바로 사라지고 본 것으로 친다
 *   </div>
 *
 * 다른 그림이 필요하면 art로 넘긴다: <Hint id="ink-pen" art={<svg …/>} />
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { useHint, type HintId } from './hints'
import '@/styles/quiet.css'

const S = (p: { children: ReactNode; size?: number }) => (
  <svg width={p.size ?? 80} height={p.size ?? 80} viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {p.children}
  </svg>
)
const Star = ({ x, y, r = 3 }: { x: number; y: number; r?: number }) => <path d={`M${x} ${y - r}l${r * 0.3} ${r * 0.7} ${r * 0.7} ${r * 0.3}-${r * 0.7} ${r * 0.3}-${r * 0.3} ${r * 0.7}-${r * 0.3}-${r * 0.7}-${r * 0.7}-${r * 0.3} ${r * 0.7}-${r * 0.3}z`} fill="currentColor" stroke="none" />
const Finger = ({ x, y, cls = 'ha-tap' }: { x: number; y: number; cls?: string }) => <circle className={cls} cx={x} cy={y} r="6" fill="var(--accent)" fillOpacity=".25" stroke="var(--accent)" />
const Key = ({ x, y, w = 18, t }: { x: number; y: number; w?: number; t: string }) => (
  <g>
    <rect x={x} y={y} width={w} height="18" rx="4" />
    <text x={x + w / 2} y={y + 13} textAnchor="middle" fontSize="10" fontFamily="var(--f-mono)" fill="currentColor" stroke="none">{t}</text>
  </g>
)

/** 기본 그림 H1–H10 */
export const HINT_ART: Record<string, ReactNode> = {
  // 오늘: 별을 톡 → 다가감, 끌면 궤도
  H1: (
    <S>
      <Star x={40} y={30} r={5} />
      <Finger x={40} y={30} />
      <path className="ha-draw ha-late" d="M16 52c10 10 38 10 48 0" />
      <path className="ha-draw ha-late" d="M58 47l6 5-7 3" />
    </S>
  ),
  // 계획: 칸을 세로로 끌어 색 칸
  H2: (
    <S>
      <path d="M14 14v52M34 14v52M54 14v52M74 14v52" opacity=".35" />
      <rect className="ha-grow" x="37" y="22" width="14" height="30" rx="2" fill="var(--accent)" fillOpacity=".25" stroke="var(--accent)" />
      <Finger x={44} y={52} cls="ha-slide" />
    </S>
  ),
  // 지도: 두 별 사이 [[ → 선
  H3: (
    <S>
      <Star x={18} y={50} r={5} />
      <Star x={62} y={26} r={5} />
      <text className="ha-fade-out" x="40" y="44" textAnchor="middle" fontSize="14" fontFamily="var(--f-mono)" fill="currentColor" stroke="none">[[</text>
      <path className="ha-draw ha-late" d="M22 47L58 29" />
    </S>
  ),
  // 복습: 카드를 누르면 뒤집힘
  H4: (
    <S>
      <rect className="ha-fade-out" x="18" y="18" width="44" height="44" rx="6" />
      <rect className="ha-fade-in" x="18" y="18" width="44" height="44" rx="6" strokeDasharray="4 3" />
      <Finger x={40} y={40} />
    </S>
  ),
  // 복습: ✓ 길게 → 세 단계
  H5: (
    <S>
      <path d="M28 52l7 7 17-17" />
      <circle className="ha-fan ha-f1" cx="22" cy="28" r="3" fill="currentColor" stroke="none" />
      <circle className="ha-fan ha-f2" cx="40" cy="20" r="3" fill="currentColor" stroke="none" />
      <circle className="ha-fan ha-f3" cx="58" cy="28" r="3" fill="currentColor" stroke="none" />
    </S>
  ),
  // 편집기: / 와 [[
  H6: (
    <S>
      <g className="ha-fade-in">
        <Key x={14} y={31} t="/" />
        <Key x={42} y={31} w={24} t="[[" />
      </g>
    </S>
  ),
  // 메모: N 키 / ＋ 톡 (그림 안에서 둘 다)
  H7: (
    <S>
      <Key x={10} y={31} t="N" />
      <circle cx="58" cy="40" r="11" />
      <path d="M58 34v12M52 40h12" />
      <Finger x={58} y={40} />
    </S>
  ),
  // ⌘K: 키 안내
  H8: (
    <S>
      <g className="ha-fade-in">
        <Key x={6} y={31} t="↑↓" w={22} />
        <Key x={32} y={31} t="↵" />
        <Key x={54} y={31} t="esc" w={22} />
      </g>
    </S>
  ),
  // 렌즈 점: 점을 톡 → 하늘이 그 색으로
  H9: (
    <S>
      <circle cx="40" cy="40" r="4" fill="var(--s-phys)" stroke="none" />
      <circle className="ha-ring" cx="40" cy="40" r="22" stroke="var(--s-phys)" />
      <Finger x={40} y={40} />
    </S>
  ),
  // 집중: ▶ 길게 → 15 · 25 · 50
  H10: (
    <S>
      <path d="M34 46v14l12-7z" />
      {(['15', '25', '50'] as const).map((t, i) => (
        <text key={t} className={`ha-fan ha-f${i + 1}`} x={18 + i * 22} y={30 - (i === 1 ? 6 : 0)} textAnchor="middle" fontSize="11" fontFamily="var(--f-mono)" fill="currentColor" stroke="none">{t}</text>
      ))}
    </S>
  ),
}

export function Hint({ id, active = true, side = 'top', art, className = '' }: { id: HintId; active?: boolean; side?: 'top' | 'bottom' | 'left' | 'right'; art?: ReactNode; className?: string }) {
  const { visible, dismiss } = useHint(id, active)
  const ref = useRef<HTMLSpanElement>(null)
  // 대상(부모)에 손대면 바로 사라진다
  useEffect(() => {
    const host = ref.current?.parentElement
    if (!visible || !host) return
    host.addEventListener('pointerdown', dismiss, true)
    host.addEventListener('keydown', dismiss, true)
    return () => {
      host.removeEventListener('pointerdown', dismiss, true)
      host.removeEventListener('keydown', dismiss, true)
    }
  }, [visible, dismiss])
  return (
    <span ref={ref} className={`hint hint-${side}${visible ? ' is-on' : ''} ${className}`} aria-hidden="true">
      {visible && (art ?? HINT_ART[id] ?? null)}
    </span>
  )
}
