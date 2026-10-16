/**
 * 그래프 v3: 별자리는 하늘이 그린다(useSkyStars graph). 화면 글은 명사구 + 메타 + 동작 하나.
 * 엔트로피 / 노트 2 · 어제 / 따라가기. 별 54 · 선 87은 누를 때만 캡션(D6). 거르기는 상단 렌즈.
 * M0: 별자리는 시드 개념 목록에서 결정적으로 만든다(실제 링크 색인은 이후).
 */
import { useMemo } from 'react'
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { buildGraph } from '@/lib/graph'
import { useNotes } from '@/db/hooks'
import { useSitAction } from './actions'
import { Actions, Block, EmptyState, FocusLines, Hero, PrimaryButton } from './parts'

export function GraphScreen() {
  const notes = useNotes()
  const run = useSitAction()
  const g = useMemo(buildGraph, [])
  const empty = !!notes && notes.length === 0
  const skyStars = { graph: empty ? { nodes: [], links: [] } : g }

  if (empty) {
    return (
      <>
        <FieldMood preset="graph" stars={skyStars} />
        <Hero label="그래프" variant="low">
          <EmptyState lines={['별자리', '올가미 → 링크']} />
        </Hero>
      </>
    )
  }

  return (
    <>
      <FieldMood preset="graph" stars={skyStars} />
      <p className="sr-only">별 {g.nodes.length}개, 선 {g.links.length}개. 별을 누르면 다가가요</p>
      <Hero label="그래프" variant="low" className="graph-hero">
        <Block>
          <FocusLines lines={['엔트로피']} />
        </Block>
        <Block>
          <p className="meta enter enter-1">노트 2 · 어제</p>
        </Block>
        <Actions>
          <PrimaryButton onClick={(el) => run({ kind: 'note', noteId: 'note-entropy' }, el)}>따라가기</PrimaryButton>
        </Actions>
      </Hero>
    </>
  )
}
