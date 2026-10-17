/**
 * 노트 v4 (design-m1 2-1): 노트 / 38개 · 물리 12 / [새 노트] + 노트 목록, 고른 노트의 종이 미리보기 1장.
 * 하늘은 오른쪽에 선 세로 띠(책등) — 글은 왼쪽·가운데에만. 과목 거르기는 상단 렌즈.
 * 폰: 위에 '노트 | 지도' 토글. 실제 편집기·필기는 M2.
 */
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { useNotes, useSubjects } from '@/db/hooks'
import type { Note, Subject } from '@/db/schema'
import { fmtAgo } from '@/lib/time'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { spaceOf } from '@/shell/spaces'
import { NotesMapToggle } from './Map'
import { Actions, Block, EmptyState, FocusLines, Hero, PrimaryButton, Reveal } from './parts'

const KIND_NAME = { ink: '필기', doc: '문서', pdf: 'PDF', deck: '카드 덱' } as const

const SKY = spaceOf('/notes')

export function NotesScreen() {
  const notes = useNotes()
  const subjects = useSubjects() ?? []
  const lens = useSettings((s) => s.lens)
  const setLens = useSettings((s) => s.setLens)
  const focusId = useUi((s) => s.noteFocusId)
  const showToast = useUi((s) => s.showToast)

  // 다른 화면으로 나가면 '이 노트로' 초점은 풀린다
  const clearFocus = () => useUi.getState().setNoteFocusId(null)

  const list = (notes ?? []).filter((n) => !lens || n.subjectId === lens)
  const focus: Note | undefined = (focusId ? (notes ?? []).find((n) => n.id === focusId) : undefined) ?? list[0]
  const subj = (id: string | null | undefined): Subject | undefined => subjects.find((s) => s.id === id)
  const fs = subj(focus?.subjectId)
  const lensSubject = subj(lens)

  // 머리 메타: 38개 · 물리 12 (렌즈가 켜져 있으면 그 과목 수만)
  const topSubject = (() => {
    const m = new Map<string, number>()
    list.forEach((n) => n.subjectId && m.set(n.subjectId, (m.get(n.subjectId) ?? 0) + 1))
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    return best ? { s: subj(best[0]), n: best[1] } : null
  })()
  const meta = lensSubject ? `${lensSubject.name} ${list.length}` : `${list.length}개${topSubject?.s ? ` · ${topSubject.s.short} ${topSubject.n}` : ''}`
  const shown = list.slice(0, 8)

  if (notes && !focus) {
    return (
      <>
        <FieldMood preset={SKY.mood} drag={SKY.drag} onLeave={clearFocus} />
        <Hero label="노트" className="notes-hero">
          <NotesMapToggle on="notes" />
          <EmptyState
            lines={lensSubject ? [lensSubject.name, '노트 없음'] : ['노트', '비어 있음']}
            action="새 노트"
            onAction={() => showToast('M2에서 열림')}
          />
          {lensSubject && (
            <div className="peri">
              <button type="button" className="peri-item" onClick={() => setLens(null)}>
                <i style={{ background: 'var(--text-3)' }} /><b>전체 보기</b>
              </button>
            </div>
          )}
        </Hero>
      </>
    )
  }

  return (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} onLeave={clearFocus} />
      {/* 글 구역: 가로 = 목록 열(왼쪽) + 종이(가운데), 세로·폰 = 한 단. 오른쪽 세로 띠(책등)는 비운다 */}
      <Hero label="노트" className="notes-hero">
        <NotesMapToggle on="notes" />
        <Block>
          <FocusLines lines={['노트']} />
        </Block>
        <Block>
          <p className="meta enter enter-1">{meta}</p>
        </Block>
        <Actions>
          <PrimaryButton onClick={() => showToast('M2에서 열림')}>새 노트</PrimaryButton>
        </Actions>
        <Block className="enter enter-2">
          <ul className="recent notes-list" aria-label="노트 목록">
            {shown.map((n) => {
              const s = subj(n.subjectId)
              const on = n.id === focus?.id
              return (
                <li key={n.id}>
                  <button type="button" aria-current={on || undefined} className={on ? 'is-on' : undefined} onClick={() => useUi.getState().setNoteFocusId(n.id)}>
                    <span>{n.title}</span>
                    <small>
                      {s && <i style={{ background: `var(--s-${s.color})` }} aria-hidden="true" />}
                      {KIND_NAME[n.kind]} · {fmtAgo(Date.now(), n.updatedAt)}
                    </small>
                  </button>
                </li>
              )
            })}
          </ul>
        </Block>
      </Hero>

      {/* 고른 노트의 종이 미리보기 1장 (가로 = 글 구역 둘째 사각형) */}
      {focus && (
        <div className="paper-stage zone-b" aria-label={`${focus.title} · ${fs?.name ?? '과목 없음'}`}>
          <Reveal className="paper-reveal">
            <Paper note={focus} color={fs ? `var(--s-${fs.color})` : 'var(--text-3)'} />
          </Reveal>
        </div>
      )}
    </>
  )
}

function Paper({ note, color }: { note: Note; color: string }) {
  return (
    <div className={`paper paper-${note.kind}`} style={{ ['--c' as string]: color }} key={note.id}>
      <div className="paper-head">
        <span>{note.title}</span>
        <span className="mono">{note.kind === 'pdf' ? `p.${note.page ?? 1} / ${note.pages ?? 1}` : note.kind === 'ink' ? `p.${note.page ?? note.pages ?? 1}` : ''}</span>
      </div>
      {note.kind === 'ink' ? (
        <svg className="ink" viewBox="0 0 400 420" preserveAspectRatio="xMidYMin meet">
          <text x="34" y="78" className="ink-f">ΔS ≥ Q / T</text>
          <path d="M30 92c60 4 120 2 182-3" className="ink-s accent" />
          <text x="36" y="150" className="ink-k">엔트로피 → 증가</text>
          <text x="36" y="196" className="ink-k small">고립계: 줄어들지 않는다</text>
          <path d="M250 300c10-70 40-120 110-130" className="ink-s" />
          <path d="M250 300h120M250 300V180" className="ink-s thin" />
          <path d="M262 290c28-6 60-40 92-104" className="ink-s accent" />
          <text x="314" y="318" className="ink-k small">T</text>
          <text x="226" y="194" className="ink-k small">S</text>
          <ellipse cx="88" cy="141" rx="66" ry="27" transform="rotate(-3 88 141)" className="ink-s lasso" />
          <path d="M40 252c30-6 70-8 120-2M40 284c22-4 50-4 84 0" className="ink-s thin" />
        </svg>
      ) : note.kind === 'pdf' ? (
        <div className="paper-lines pdf">
          <i style={{ width: '62%' }} /><i /><i /><i style={{ width: '86%' }} />
          <div className="pdf-fig" />
          <i /><i style={{ width: '74%' }} /><i /><i style={{ width: '52%' }} />
        </div>
      ) : note.kind === 'deck' ? (
        <div className="deck-stack">
          <div className="deck-card">“이 그래프가 보여 주듯이”</div>
          <div className="deck-card back" />
          <div className="deck-card back2" />
        </div>
      ) : (
        <div className="paper-lines">
          <b style={{ width: '58%' }} /><i /><i /><i style={{ width: '80%' }} /><i /><i style={{ width: '64%' }} />
          <b style={{ width: '40%' }} /><i /><i style={{ width: '90%' }} /><i style={{ width: '70%' }} />
        </div>
      )}
    </div>
  )
}
