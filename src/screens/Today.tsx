/**
 * 오늘 v4: 글 구역(design-m1 2-1) 안에 명사구 1 + 메타 1 + 동작 1(+보조) — 3줄. 아래 장은 '최근' 하나만.
 * 폰: 맨 아래 한 줄 '계획 · 시험 D-5 ›'을 누르면 계획으로(폰 독에는 계획이 없다).
 * 하늘이 말한다(D5): 오늘 집중 = 오늘의 별(별자리), 시험 임박 = 붉은 별, 남은 수업 = 진행선, 복습량 = 복습 별.
 */
import { useMemo, useRef } from 'react'
import { ProgressLine } from '@/fx'
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { useNow, useToday } from '@/db/hooks'
import type { Subject } from '@/db/schema'
import { evaluateSituation } from '@/lib/situation'
import { ddayOf, fmtAgo, fmtDday, fmtDur } from '@/lib/time'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useGo } from '@/shell/hooks'
import { spaceOf } from '@/shell/spaces'
import { IconArrow, IconMic } from '@/shell/icons'
import { useResolvedColors, useSitAction, type ColorKey } from './actions'
import { Actions, Block, Chapter, FocusLines, Hero, PrimaryButton, QuietButton } from './parts'

const SKY = spaceOf('/')

export function TodayScreen() {
  const { now, forceEmpty } = useNow()
  const data = useToday(now, forceEmpty)
  const lens = useSettings((s) => s.lens)
  const knotRef = useRef<HTMLSpanElement>(null)
  const run = useSitAction()
  const go = useGo()
  const colors = useResolvedColors()

  const sit = useMemo(() => (data ? evaluateSituation(data.model) : null), [data])
  const subjects: Subject[] = data?.model.subjects ?? []
  const colorOf = (id: string | null | undefined): string | undefined => {
    const s = subjects.find((x) => x.id === id)
    return s ? colors[s.color as ColorKey] : undefined
  }

  const skyData = { rings: sit?.rings ?? 0, load: sit?.load ?? 0.3, pressure: sit?.pressure ?? 0, tint: colorOf(lens ?? sit?.tintSubject ?? null) }
  const sessions = data?.model.focusToday.sessions
  const skyStars = {
    today: (sessions ?? []).map((s) => ({ id: s.id, at: s.startedAt, kind: 'set' as const })),
    exam: sit?.exam ?? null,
  }

  if (!data || !sit) {
    return (
      <>
        <FieldMood preset={SKY.mood} drag={SKY.drag} knotRef={knotRef} />
        <Hero knotRef={knotRef} label="오늘">
          <div className="hero-placeholder" aria-hidden="true" />
        </Hero>
      </>
    )
  }

  const fm = data.model.focusToday
  // 계획 줄: 가장 가까운 시험, 없으면 가장 가까운 마감
  const nowMs = data.model.now.getTime()
  const upcoming = data.model.tasks.filter((t) => !t.done && t.dueAt >= nowMs).sort((x, y) => x.dueAt - y.dueAt)
  const nextExam = upcoming.find((t) => t.kind === 'exam')
  const nextTask = nextExam ?? upcoming[0]
  const planNext = nextTask ? `${nextExam ? '시험' : '마감'} ${fmtDday(ddayOf(data.model.now, nextTask.dueAt))}` : null
  const skyLabel = fm.sets ? `오늘의 별 ${fm.sets}개, 집중 ${fmtDur(fm.minutes)}` : '오늘의 별 없음'

  return (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} knotRef={knotRef} override={{ speed: sit.mood.speed, knotStrength: sit.mood.knotStrength }} data={skyData} stars={skyStars} />

      <Hero knotRef={knotRef} label="지금">
        {/* 하늘의 오늘의 별은 StarPress가 누르기를 받는다(다가가 한 줄로 보기) */}
        <p className="sr-only">{skyLabel}</p>
        <Block>
          <FocusLines lines={[sit.title]} swapKey={sit.key + sit.title} />
        </Block>
        <Block>
          <p className="meta enter enter-1" key={sit.key + sit.meta}>{sit.meta}</p>
        </Block>
        {sit.progress && (
          <Block className="enter enter-1">
            <ProgressLine value={sit.progress.value} label={sit.progress.label} tone="quiet" width="min(420px, 100%)" />
          </Block>
        )}
        {(sit.primary || sit.quiet) && (
          <Actions swapKey={sit.key}>
            {sit.primary && <PrimaryButton onClick={(el) => run(sit.primary!.action, el)}>{sit.primary.label}</PrimaryButton>}
            {sit.quiet &&
              (sit.quiet.label === '녹음' ? (
                <button type="button" className="icon-btn ghost" aria-label="녹음하며 쓰기" onClick={(e) => run(sit.quiet!.action, e.currentTarget)}>
                  <IconMic size={20} />
                </button>
              ) : (
                <QuietButton onClick={(el) => run(sit.quiet!.action, el)}>{sit.quiet.label}</QuietButton>
              ))}
          </Actions>
        )}
      </Hero>

      {/* 폰: 맨 아래 계획 줄 (글 구역 둘째 사각형) */}
      <a
        className="plan-line zone-b phone-only-flex"
        href="/plan"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          void go('/plan', e.currentTarget)
        }}
      >
        <span>계획</span>
        {planNext && <span className="plan-line-v">· {planNext}</span>}
        <IconArrow size={14} />
      </a>

      {sit.key !== 'empty' && data.recent.length > 0 && (
        <Chapter eyebrow="최근" title={[]} className="chapter-last chapter-recent">
          <ul className="cont">
            {data.recent.map((n) => {
              const s = subjects.find((x) => x.id === n.subjectId)
              return (
                <li key={n.id}>
                  <button type="button" onClick={(e) => run({ kind: 'note', noteId: n.id }, e.currentTarget)}>
                    <span className="cont-title">{n.title}</span>
                    <small>
                      {s && <i style={{ background: `var(--s-${s.color})` }} aria-hidden="true" />}
                      {s?.name ?? '과목 없음'} · {fmtAgo(Date.now(), n.updatedAt)}
                    </small>
                  </button>
                </li>
              )
            })}
          </ul>
          <a
            className="link-more"
            href="/notes"
            aria-label="노트 모두 보기"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) return
              e.preventDefault()
              useUi.getState().setNoteFocusId(null)
              void go('/notes', e.currentTarget)
            }}
          >
            모두 <IconArrow size={16} />
          </a>
        </Chapter>
      )}
    </>
  )
}
