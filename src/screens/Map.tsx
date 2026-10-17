/**
 * 지도(← 그래프) v4: 별자리는 하늘이 그린다(useSkyStars graph). 화면 글은 머리 하나(design-m1 2-1 글 구역 왼쪽 위):
 * 지도 / 별 54 · 선 87 / 과목 렌즈 칩 한 줄. 별 정보(노트 제목 / 물리 · 링크 3 / 열기)는 누를 때만 StarPress가 오른쪽 아래에.
 * 폰: 위에 '노트 | 지도' 토글(폰 독에는 지도가 없다).
 * M0: 별자리는 시드 개념 목록에서 결정적으로 만든다(실제 링크 색인은 이후).
 */
import { useMemo } from 'react'
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { buildGraph } from '@/lib/graph'
import { useNotes, useSubjects } from '@/db/hooks'
import { useSettings } from '@/stores/settings'
import { useGo } from '@/shell/hooks'
import { IconMap, IconNote } from '@/shell/icons'
import { spaceOf } from '@/shell/spaces'
import { Block, EmptyState, FocusLines, Hero } from './parts'

const SKY = spaceOf('/map')

/** 폰 전용 '노트 | 지도' 토글 (노트 화면과 같은 모양) */
export function NotesMapToggle({ on }: { on: 'notes' | 'map' }) {
  const go = useGo()
  const to = on === 'notes' ? '/map' : '/notes'
  return (
    <a
      className="phone-only seg-link"
      href={to}
      aria-label={on === 'notes' ? '지도로' : '노트로'}
      onClick={(e) => {
        e.preventDefault()
        void go(to, e.currentTarget)
      }}
    >
      <span className={`seg${on === 'notes' ? ' is-on' : ''}`}><IconNote size={16} /> 노트</span>
      <span className={`seg${on === 'map' ? ' is-on' : ''}`}><IconMap size={16} /> 지도</span>
    </a>
  )
}

export function MapScreen() {
  const notes = useNotes()
  const subjects = useSubjects() ?? []
  const lens = useSettings((s) => s.lens)
  const setLens = useSettings((s) => s.setLens)
  const g = useMemo(buildGraph, [])
  const empty = !!notes && notes.length === 0
  const skyStars = { graph: empty ? { nodes: [], links: [] } : g }

  if (empty) {
    return (
      <>
        <FieldMood preset={SKY.mood} drag={SKY.drag} stars={skyStars} />
        <Hero label="지도" className="map-hero">
          <NotesMapToggle on="map" />
          <EmptyState lines={['별자리', '올가미 → 링크']} />
        </Hero>
      </>
    )
  }

  return (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} stars={skyStars} />
      <Hero label="지도" className="map-hero">
        <NotesMapToggle on="map" />
        <Block>
          <FocusLines lines={['지도']} className="map-title" />
        </Block>
        <Block>
          <p className="meta enter enter-1">별 {g.nodes.length} · 선 {g.links.length}</p>
        </Block>
        <Block className="enter enter-1">
          <div className="lens-chips" role="radiogroup" aria-label="과목 렌즈">
            {[null, ...subjects].map((s) => {
              const id = s?.id ?? null
              return (
                <button key={id ?? 'all'} type="button" role="radio" aria-checked={lens === id} className="chip lens-chip" onClick={() => setLens(id)}>
                  <i style={{ background: s ? `var(--s-${s.color})` : 'var(--text-3)' }} aria-hidden="true" />
                  {s ? s.short : '전체'}
                </button>
              )
            })}
          </div>
        </Block>
        <p className="sr-only">별을 누르면 다가가요</p>
      </Hero>
    </>
  )
}
