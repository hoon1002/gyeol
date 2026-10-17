/** 종이 머리의 후보 수(M4) → 그 노트 후보만 후보함에서(복습 장소). 글 노트 · 필기 종이가 같이 쓴다 */
import { useGo } from '@/shell/hooks'
import { IconCandidate } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { openCandidates } from '@/memory/intent'
import '@/styles/memhead.css'

export function PaperCands({ noteId, n }: { noteId: string; n: number }) {
  const go = useGo()
  return (
    <button
      type="button"
      className="ibtn np-mini np-cands"
      {...tip(`후보 ${n}`)}
      onClick={(e) => {
        openCandidates(noteId)
        void go('/review', e.currentTarget)
      }}
    >
      <IconCandidate size={16} />
      <span className="mono">{n > 99 ? '99+' : n}</span>
    </button>
  )
}
