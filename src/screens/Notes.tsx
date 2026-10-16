/**
 * 노트 첫 화면 (design-v2 4-2): "이어서 쓰기 — 엔트로피와 열역학 제2법칙" + 큰 종이 미리보기 1장.
 * 주변부: 과목 책등 6개 · 최근 3 · 새 노트. 필드: 거의 정지, 세로 결(괘선 느낌), 옹이 없음.
 * 실제 편집기·필기는 M1.
 */
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { useNotes, useSubjects } from '@/db/hooks'
import type { Note, Subject } from '@/db/schema'
import { fmtAgo } from '@/lib/time'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useGo } from '@/shell/hooks'
import { IconGraph, IconNote } from '@/shell/icons'
import { Actions, Block, EmptyState, FocusLines, Hero, PrimaryButton, QuietButton, Reveal } from './parts'

const KIND_NAME = { ink: '필기', doc: '문서', pdf: 'PDF', deck: '카드 덱' } as const

export function NotesScreen() {
  const notes = useNotes()
  const subjects = useSubjects() ?? []
  const lens = useSettings((s) => s.lens)
  const setLens = useSettings((s) => s.setLens)
  const focusId = useUi((s) => s.noteFocusId)
  const showToast = useUi((s) => s.showToast)
  const go = useGo()

  // 다른 화면으로 나가면 '이 노트로' 초점은 풀린다
  const clearFocus = () => useUi.getState().setNoteFocusId(null)

  const list = (notes ?? []).filter((n) => !lens || n.subjectId === lens)
  const focus: Note | undefined = (focusId ? (notes ?? []).find((n) => n.id === focusId) : undefined) ?? list[0]
  const subj = (id: string | null | undefined): Subject | undefined => subjects.find((s) => s.id === id)
  const fs = subj(focus?.subjectId)
  const recent = list.filter((n) => n.id !== focus?.id).slice(0, 3)
  const lensSubject = subj(lens)

  const graphToggle = (
    <a
      className="phone-only seg-link"
      href="/graph"
      onClick={(e) => {
        e.preventDefault()
        void go('/graph', e.currentTarget)
      }}
    >
      <span className="seg is-on"><IconNote size={16} /> 노트</span>
      <span className="seg"><IconGraph size={16} /> 그래프</span>
    </a>
  )

  if (notes && !focus) {
    return (
      <>
        <FieldMood preset="notes" onLeave={clearFocus} />
        <Hero label="노트" variant="low">
          {graphToggle}
          <EmptyState
            lines={lensSubject ? [lensSubject.name, '노트 없음'] : ['노트', '비어 있음']}
            action="새 노트"
            onAction={() => showToast('M1에서 열림')}
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
      <FieldMood preset="notes" onLeave={clearFocus} />
      <Hero label="노트" className="notes-hero">
        {graphToggle}
        <Block>
          <span className="sr-only">이어 쓰기</span>
        </Block>
        <Block>
          <FocusLines lines={[focus?.title ?? ' ']} swapKey={focus?.id} className="focus-lines-title" />
        </Block>
        <Block>
          <p className="focus-meta enter enter-1" key={focus?.id}>
            {fs && <i style={{ background: `var(--s-${fs.color})` }} aria-hidden="true" />}
            {fs?.name ?? '과목 없음'} · {focus ? fmtAgo(Date.now(), focus.updatedAt) : ''}
          </p>
        </Block>
        <Actions swapKey={focus?.id}>
          <PrimaryButton onClick={() => showToast('M1에서 열림', fs ? `var(--s-${fs.color})` : undefined)}>이어 쓰기</PrimaryButton>
          <QuietButton onClick={() => showToast('M1에서 열림')}>새 노트</QuietButton>
        </Actions>

        {/* 주변부 1: 과목 책등 */}
        <Block className="spines-wrap enter enter-2">
          <ul className="spines" aria-label="과목 책등">
            {subjects.map((s) => {
              const count = (notes ?? []).filter((n) => n.subjectId === s.id).length
              const on = lens === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`spine${on ? ' is-on' : ''}`}
                    style={{ ['--c' as string]: `var(--s-${s.color})` }}
                    aria-pressed={on}
                    aria-label={`${s.name} 노트 ${count}개${on ? ' · 렌즈 켜짐' : ''}`}
                    onClick={() => setLens(on ? null : s.id)}
                  >
                    <span className="spine-name" aria-hidden="true">{s.short}</span>
                    <span className="spine-n mono" aria-hidden="true">{count}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Block>

      </Hero>

      {/* 초점의 짝: 큰 종이 미리보기 1장 (화면의 유일한 '면') */}
      {focus && (
        <div className="paper-stage" aria-hidden="true">
          <Reveal className="paper-reveal">
            <Paper note={focus} color={fs ? `var(--s-${fs.color})` : 'var(--text-3)'} />
          </Reveal>
        </div>
      )}
        {/* 주변부 2: 최근 3 */}
      {recent.length > 0 && (
        <section className="chapter chapter-recent notes-recent" aria-label="최근">
          <ul className="recent" aria-label="최근 노트">
            {recent.map((n) => {
              const s = subj(n.subjectId)
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => useUi.getState().setNoteFocusId(n.id)}>
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
        </section>
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
