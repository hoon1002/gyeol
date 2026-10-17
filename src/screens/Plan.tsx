/**
 * 계획: 글 구역(design-m1 2-1) 하나에 머리(이번 주 / 과제 n · 시험 D-n / ＋ 추가 · ⋯) + 주간 시간표 격자.
 * M2(design-m2 6장): 격자에서 바로 수업 칸을 그린다(가로 = 세로로 끌기, 폰 = 누르기 + 손잡이). ⋯ → '캘린더 파일 가져오기'(.ics).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActiveMood as FieldMood } from '@/app/keepAlive'
import { useNow, usePlanner, useSubjects } from '@/db/hooks'
import { addDays, ddayOf, fmtDday, fmtMD, startOfWeek } from '@/lib/time'
import { useUi } from '@/stores/ui'
import { spaceOf } from '@/shell/spaces'
import { IconMore } from '@/shell/icons'
import { Timetable } from '@/capture/Timetable'
import { IcsButton } from '@/capture/IcsImport'
import { dbStore } from '@/capture/slots'
import { NO_DUE } from '@/capture/file'
import { Actions, Block, FocusLines, PrimaryButton } from './parts'

const SKY = spaceOf('/plan')

export function PlanScreen() {
  const { now } = useNow()
  const data = usePlanner()
  const subjects = useSubjects()
  const knotRef = useRef<HTMLSpanElement>(null)
  const openPalette = useUi((s) => s.openPalette)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const off = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.ics-layer')) setMenu(false)
    }
    window.addEventListener('pointerdown', off)
    return () => window.removeEventListener('pointerdown', off)
  }, [menu])

  const slots = data?.slots ?? []
  const store = useMemo(() => dbStore(subjects ?? [], slots), [subjects, slots])

  const ws = startOfWeek(now)
  const tasks = data?.tasks ?? []
  const open = tasks.filter((t) => !t.done && t.dueAt >= now.getTime())
  const todo = tasks.filter((t) => !t.done && t.dueAt === NO_DUE).length
  const assignments = open.filter((t) => t.kind !== 'exam').length
  const exam = open.find((t) => t.kind === 'exam')
  const meta = [slots.length ? `수업 ${slots.length}` : null, `과제 ${assignments}`, todo ? `할 일 ${todo}` : null, exam ? `시험 ${fmtDday(ddayOf(now, exam.dueAt))}` : null].filter(Boolean).join(' · ')

  return (
    <>
      <FieldMood preset={SKY.mood} drag={SKY.drag} knotRef={knotRef} />
      <section className="hero hero-zone plan" aria-label="계획">
        <div className="zone-a plan-zone">
          <div className="hero-col plan-head">
            <Block>
              <FocusLines lines={[slots.length ? '이번 주' : '시간표']} />
            </Block>
            <Block>
              <p className="meta enter enter-1" title={`${fmtMD(ws)} – ${fmtMD(addDays(ws, 6))}`}>{slots.length ? meta : '빈 칸을 끌어 수업 넣기'}</p>
            </Block>
            <Actions>
              <PrimaryButton onClick={(el) => openPalette('과제 추가 ', el)}>＋ 추가</PrimaryButton>
              <div className="plan-more" ref={menuRef}>
                <button type="button" className="icon-btn ghost" aria-label="더 보기" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
                  <IconMore size={20} />
                </button>
                {/* 메뉴를 닫아도 미리보기 시트가 살아 있게 늘 마운트(hidden으로만 숨김) */}
                <div className="plan-menu" role="menu" hidden={!menu}>
                  <IcsButton store={store} className="plan-menu-item" label="캘린더 파일 가져오기" onPicked={() => setMenu(false)} />
                </div>
              </div>
            </Actions>
          </div>
          <section className="week-grid-wrap" aria-label="이번 주 시간표">
            {data && subjects && <Timetable store={store} now={now} knotRef={knotRef} />}
          </section>
        </div>
      </section>
    </>
  )
}
