/**
 * 플래너 첫 화면 (design-v2 4-2): "이번 주, 수업 9개 · 마감 2개" + 이번 주 시간표(선만 있는 격자, 오늘 열만 진하게).
 * 주변부: D-day 3개. 필드: 결이 가로(시간 축)로 흐름, 옹이 = 지금.
 */
import { useRef } from 'react'
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { useNow, usePlanner, useSubjects } from '@/db/hooks'
import { addDays, ddayOf, fmtDday, fmtHM, fmtMD, hm, minutesOfDay, startOfWeek, weekdayShort } from '@/lib/time'
import type { Peri } from '@/lib/situation'
import { useUi } from '@/stores/ui'
import { useIsPhone } from '@/shell/hooks'
import { Actions, Block, EmptyState, FocusLines, Hero, Periphery, PrimaryButton, QuietButton, Reveal } from './parts'

export function PlannerScreen() {
  const { now } = useNow()
  const data = usePlanner()
  const subjects = useSubjects() ?? []
  const knotRef = useRef<HTMLSpanElement>(null)
  const openPalette = useUi((s) => s.openPalette)
  const showToast = useUi((s) => s.showToast)
  const phone = useIsPhone()

  const sub = (id: string | null) => subjects.find((s) => s.id === id)
  const color = (id: string | null) => {
    const s = sub(id)
    return s ? `var(--s-${s.color})` : 'var(--text-3)'
  }

  if (data && data.slots.length === 0) {
    return (
      <>
        <FieldMood preset="planner" />
        <Hero label="플래너" variant="low">
          <EmptyState
            lines={['시간표', '비어 있음']}
            action="수업 추가"
            onAction={() => showToast('M1에서 열림')}
          />
        </Hero>
      </>
    )
  }

  const slots = data?.slots ?? []
  const ws = startOfWeek(now)
  const open = (data?.tasks ?? []).filter((t) => !t.done && t.dueAt >= now.getTime())
  const todayIdx = (now.getDay() + 6) % 7
  const hasWeekend = slots.some((s) => s.weekday === 0 || s.weekday === 6) || todayIdx >= 5
  const days = hasWeekend ? 7 : 5
  const startH = Math.min(9, ...slots.map((s) => Math.floor(hm(s.start) / 60)))
  const endH = Math.max(18, ...slots.map((s) => Math.ceil(hm(s.end) / 60)))
  const span = (endH - startH) * 60
  const nowMin = minutesOfDay(now)
  const nowTop = ((nowMin - startH * 60) / span) * 100
  const nowVisible = nowMin >= startH * 60 && nowMin <= endH * 60

  const peri: Peri[] = open.slice(0, 3).map((t) => ({
    id: t.id,
    label: t.title,
    value: fmtDday(ddayOf(now, t.dueAt)),
    color: color(t.subjectId),
    shelf: [
      { k: '마감', v: `${weekdayShort(new Date(t.dueAt).getDay())}요일 ${fmtHM(t.dueAt)}`, color: color(t.subjectId) },
      { k: '과목', v: sub(t.subjectId)?.name ?? '미정' },
      { k: '종류', v: t.kind === 'exam' ? '시험' : t.kind === 'quiz' ? '퀴즈' : '과제' },
    ],
  }))

  return (
    <>
      <FieldMood preset="planner" knotRef={knotRef} />
      <Hero label="플래너" variant="low" className="planner-hero">
        <Block>
          <FocusLines lines={['이번 주']} />
        </Block>
        <Block>
          <p className="meta enter enter-1">{fmtMD(ws)} – {fmtMD(addDays(ws, 6))} · 마감 {open.length}</p>
        </Block>
        <Actions>
          <PrimaryButton onClick={(el) => openPalette('과제 추가 ', el)}>+ 과제</PrimaryButton>
          <QuietButton onClick={() => showToast('M1에서 열림')}>붙여 넣기</QuietButton>
        </Actions>
        <Periphery items={peri} />
      </Hero>

      <section className="week-grid-wrap" aria-label="이번 주 시간표">
        <Reveal>
          <div className="week-grid" style={{ ['--days' as string]: days, ['--rows' as string]: endH - startH }}>
            <div className="wg-hours" aria-hidden="true">
              {Array.from({ length: endH - startH + 1 }, (_, i) => (
                <span key={i} style={{ top: `${(i / (endH - startH)) * 100}%` }}>{startH + i}</span>
              ))}
            </div>
            {Array.from({ length: days }, (_, d) => {
              const weekday = (d + 1) % 7
              const isToday = d === todayIdx
              const date = addDays(ws, d)
              const list = slots.filter((s) => s.weekday === weekday).sort((a, b) => hm(a.start) - hm(b.start))
              return (
                <div key={d} className={`wg-col${isToday ? ' is-today' : ''}`} role="group" aria-label={`${weekdayShort(weekday)}요일 ${date.getDate()}일, 수업 ${list.length}개${isToday ? ', 오늘' : ''}`}>
                  <div className="wg-head">
                    <span>{weekdayShort(weekday)}</span>
                    <span className="mono">{date.getDate()}</span>
                  </div>
                  <div className="wg-body">
                    {list.map((s) => {
                      const top = ((hm(s.start) - startH * 60) / span) * 100
                      const h = ((hm(s.end) - hm(s.start)) / span) * 100
                      const subj = sub(s.subjectId)
                      return (
                        <div key={s.id} className="wg-slot" style={{ top: `${top}%`, height: `${h}%`, ['--c' as string]: color(s.subjectId) }}>
                          <b>{phone ? subj?.short : subj?.name}</b>
                          {!phone && <small>{s.start} · {s.room}</small>}
                        </div>
                      )
                    })}
                    {isToday && nowVisible && (
                      <div className="wg-now" style={{ top: `${nowTop}%` }}>
                        <span ref={knotRef} className="wg-now-dot" />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Reveal>
      </section>
    </>
  )
}
