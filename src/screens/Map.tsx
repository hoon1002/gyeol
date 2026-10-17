/**
 * 지도(← 그래프) v4 → M2: 노트마다 별 하나, [[링크]]마다 빛줄기(useSkyStars notes · noteLinks · subjects, design-m2 4-3).
 * 화면 글은 머리 하나(design-m1 2-1 글 구역 왼쪽 위): 지도 / 별 n · 선 m / 과목 렌즈 칩 한 줄.
 * 별 정보(노트 제목 / 물리 · 링크 3 / 열기)는 누를 때만 StarPress가 오른쪽 아래에.
 * 폰: 위에 '노트 | 지도' 토글(폰 독에는 지도가 없다).
 */
import { useMemo } from 'react'
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { useNoteStars, useSkySubjects } from '@/db/notes'
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
  const stars = useNoteStars()
  const skySubjects = useSkySubjects(subjects)
  const empty = !!notes && notes.length === 0
  const skyStars = useMemo(() => (stars ? { notes: stars.notes, noteLinks: stars.noteLinks, subjects: skySubjects } : undefined), [stars, skySubjects])

  if (empty) {
    return (
      <>
        <FieldMood preset={SKY.mood} drag={SKY.drag} stars={skyStars} />
        <Hero label="지도" className="map-hero">
          <NotesMapToggle on="map" />
          <EmptyState lines={['별자리', '[[ → 빛줄기']} />
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
          <p className="meta enter enter-1">별 {stars?.notes.length ?? notes?.length ?? 0} · 선 {stars?.noteLinks.length ?? 0}</p>
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
      </Hero>
    </>
  )
}
