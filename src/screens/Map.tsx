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
import { tip } from '@/shell/Tip'
import { Hint } from '@/shell/Hint'
import { Hero } from './parts'

const SKY = spaceOf('/map')

/** 폰 전용 '노트 | 지도' 토글 (노트 화면과 같은 모양) */
export function NotesMapToggle({ on }: { on: 'notes' | 'map' }) {
  const go = useGo()
  const to = on === 'notes' ? '/map' : '/notes'
  return (
    <a
      className="phone-only seg-link"
      href={to}
      {...tip(on === 'notes' ? '지도' : '노트')}
      onClick={(e) => {
        e.preventDefault()
        void go(to, e.currentTarget)
      }}
    >
      <span className={`seg seg-i${on === 'notes' ? ' is-on' : ''}`}><IconNote size={18} /></span>
      <span className={`seg seg-i${on === 'map' ? ' is-on' : ''}`}><IconMap size={18} /></span>
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

  const nStars = stars?.notes.length ?? notes?.length ?? 0
  const nLines = stars?.noteLinks.length ?? 0

  if (empty) {
    return (
      <>
        <FieldMood preset={SKY.mood} drag={SKY.drag} stars={skyStars} />
        <Hero label="지도" className="map-hero">
          <h1 className="sr-only">지도</h1>
          <NotesMapToggle on="map" />
          {/* 빈 지도: 첫 회 그림(H3) — 두 별 사이 [[ 가 선으로 */}
          <span className="map-h3" aria-hidden="true">
            <Hint id="H3" side="bottom" />
          </span>
        </Hero>
      </>
    )
  }

  return (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} stars={skyStars} />
      <Hero label="지도" className="map-hero">
        <h1 className="sr-only">지도</h1>
        <p className="sr-only">
          별 {nStars} · 선 {nLines}
        </p>
        <NotesMapToggle on="map" />
        {/* 과목 렌즈: 색 점 줄(전체 = 빈 고리, 고른 것 = 고리 + 점). 이름은 툴팁 */}
        <div className="lens-dots enter enter-1" role="radiogroup" aria-label="과목 렌즈">
          {[null, ...subjects].map((s) => {
            const id = s?.id ?? null
            return (
              <button key={id ?? 'all'} type="button" role="radio" aria-checked={lens === id} className="lens-dot" {...tip(s ? s.name : '전체')} onClick={() => setLens(id)}>
                <i className={`sdot is-lg${s ? '' : ' is-none'}`} style={s ? { ['--c' as string]: `var(--s-${s.color})` } : undefined} />
              </button>
            )
          })}
        </div>
      </Hero>
    </>
  )
}
