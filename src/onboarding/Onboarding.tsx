/**
 * 첫 실행 2분 = 순간 ① '성운이 태어나는 첫 밤' (design-m2 9장, 리더 결정 1: 과목 → 시간표 → 은하 보이기).
 * 조건: 과목 0 · 노트 0 · 메모 0이고 meta.onboarded가 아니면 오늘 위에 띄운다. 오른쪽 위 '건너뛰기'.
 * 하늘: 오늘 화면의 preset이 'onboarding'(지도 성운에 다가간 자세)이 되고, 과목마다 bloomNebula, 마지막에 await revealGalaxy() → 오늘 자세.
 * 개발용 ?onboarding=1 = 메모리 모드(DB에 쓰지 않음 → 실제 데이터 그대로). 설정 '처음 화면 다시 보기' = 실제 모드.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db, type CourseSlot, type Subject, type SubjectColor } from '@/db/schema'
import { seedSample } from '@/db/seed'
import { useNow, usePlanner, useSubjects } from '@/db/hooks'
import { useUi } from '@/stores/ui'
import { useCapture, type OnboardingMode } from '@/capture/store'
import { COLORS, dbStore, makeSlot, makeSubject, nextColor, type TimetableStore } from '@/capture/slots'
import { skyBloom, skyReveal, subjectColorValue } from '@/capture/sky'
import { Timetable } from '@/capture/Timetable'
import { IcsButton } from '@/capture/IcsImport'
import { IosInstallLine } from '@/onboarding/IosInstall'
import '@/styles/onboarding.css'

type Step = 0 | 1 | 2 | 3

/** 메모리 저장소 (?onboarding=1) */
function useMemoryStore(): TimetableStore & { removeSubject: (id: string) => void } {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [slots, setSlots] = useState<CourseSlot[]>([])
  return useMemo(
    () => ({
      subjects,
      slots,
      createSubject: async (name, color) => {
        const s = makeSubject(name, color, subjects.length)
        setSubjects((x) => [...x, s])
        return s
      },
      saveSlot: async (input) => {
        const slot = makeSlot(input, slots.find((x) => x.id === input.id))
        setSlots((x) => [...x.filter((y) => y.id !== slot.id), slot])
        return slot
      },
      deleteSlot: async (id) => setSlots((x) => x.filter((y) => y.id !== id)),
      restoreSlot: async (s) => setSlots((x) => [...x, s]),
      removeSubject: (id) => {
        setSubjects((x) => x.filter((y) => y.id !== id))
        setSlots((x) => x.filter((y) => y.subjectId !== id))
      },
    }),
    [subjects, slots],
  )
}

export function Onboarding() {
  const forced = useCapture((s) => s.onboarding)
  const st = useLiveQuery(async () => {
    const [s, n, m, o] = await Promise.all([db.subjects.count(), db.notes.count(), db.memos.count(), db.meta.get('onboarded')])
    return { empty: s === 0 && n === 0 && m === 0, onboarded: o?.value === true }
  }, [])
  const mode: OnboardingMode | null = forced ?? (st && st.empty && !st.onboarded ? 'real' : null)
  return mode ? <Flow mode={mode} /> : null
}

function Flow({ mode }: { mode: OnboardingMode }) {
  const router = useRouter()
  const { now } = useNow()
  const dbSubjects = useSubjects() ?? []
  const planner = usePlanner()
  const mem = useMemoryStore()
  const real = useMemo(() => dbStore(dbSubjects, planner?.slots ?? []), [dbSubjects, planner])
  const store: TimetableStore = mode === 'dry' ? mem : real
  const [step, setStep] = useState<Step>(0)
  const [grid, setGrid] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const end = useCapture((s) => s.endOnboarding)
  const setActive = useCapture((s) => s.setOnbActive)

  // 떠 있는 동안: 오늘로, 크롬 숨김, 오늘 하늘 = onboarding 자세, n 단축키 막기
  useEffect(() => {
    if (router.state.location.pathname !== '/') void router.navigate({ to: '/', replace: true })
    const root = document.documentElement
    root.setAttribute('data-onboarding', '')
    useUi.getState().setChromeHidden(true)
    setActive(true)
    return () => {
      root.removeAttribute('data-onboarding')
      useUi.getState().setChromeHidden(false)
      setActive(false)
    }
  }, [router, setActive])

  const finish = async () => {
    if (mode === 'real') await db.meta.put({ key: 'onboarded', value: true })
    end()
  }

  const sample = async () => {
    setBusy(true)
    let list: Array<{ id: string; color: string }>
    if (mode === 'real') {
      await seedSample()
      list = (await db.subjects.where('id').startsWith('seed-').sortBy('order')).map((s) => ({ id: s.id, color: s.color }))
    } else {
      list = COLORS.slice(0, 6).map((c, i) => ({ id: `dry-${i}`, color: c }))
    }
    // 성운 6개를 250ms 간격으로 피우고 이어서 은하 보이기 (합계 약 4.5초)
    list.forEach((s, i) => window.setTimeout(() => skyBloom(s.id, subjectColorValue(s.color)), i * 250))
    await new Promise((r) => setTimeout(r, list.length * 250 + 600))
    await skyReveal()
    await finish()
  }

  useEffect(() => {
    if (step !== 3) return
    let alive = true
    void skyReveal().then(() => alive && setRevealed(true))
    return () => {
      alive = false
    }
  }, [step])

  const slots = store.slots
  return (
    <div className="onb-layer">
      <button type="button" className="onb-skip mono" onClick={() => void finish()}>건너뛰기</button>
      <div className={`onb${grid && step === 2 ? ' is-wide' : ''}`} data-zone-place="/" role="dialog" aria-label="처음 시작">
        {step === 0 && (
          <div className="onb-step" key="s0">
            <h1 className="onb-h">결</h1>
            <p className="meta">은하 하나로 쓰는 공부 기록</p>
            <div className="actions">
              <button type="button" className="btn-primary" autoFocus onClick={() => setStep(1)}>시작</button>
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => void sample()}>샘플로 시작</button>
            </div>
          </div>
        )}
        {step === 1 && <Subjects store={store} mode={mode} onNext={() => setStep(2)} removeMem={mem.removeSubject} />}
        {step === 2 && (
          <div className="onb-step" key="s2">
            <h1 className="onb-h">시간표</h1>
            <p className="meta mono">수업 {slots.length}</p>
            <div className="onb-row">
              <IcsButton store={store} className="btn-ghost small" label="캘린더 파일" />
              <button type="button" className="btn-ghost small" aria-pressed={grid} onClick={() => setGrid((v) => !v)}>직접 그리기</button>
            </div>
            {grid && <Timetable store={store} now={now} className="onb-grid" />}
            <div className="actions">
              <button type="button" className="btn-primary" onClick={() => setStep(3)}>다 됐어요</button>
              <button type="button" className="btn-quiet" onClick={() => setStep(3)}>나중에</button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="onb-step" key="s3">
            <h1 className="onb-h">내 은하</h1>
            <p className="meta mono">과목 {store.subjects.length} · 수업 {slots.length}</p>
            <IosInstallLine once />
            <div className="actions">
              <button type="button" className="btn-primary" autoFocus disabled={!revealed} onClick={() => void finish()}>시작</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Subjects({ store, mode, onNext, removeMem }: { store: TimetableStore; mode: OnboardingMode; onNext: () => void; removeMem: (id: string) => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<SubjectColor | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const list = store.subjects
  const auto = nextColor(list)
  const pick = color && !list.some((s) => s.color === color) ? color : auto
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])

  const add = async () => {
    const n = name.trim()
    if (!n || list.some((s) => s.name === n)) return
    const s = await store.createSubject(n, pick)
    skyBloom(s.id, subjectColorValue(s.color))
    setName('')
    setColor(null)
    // 여섯 번째에서는 Enter 뒤 600ms에 다음 단계로
    if (list.length + 1 >= 6) window.setTimeout(onNext, 600)
  }
  const remove = async (s: Subject) => {
    if (mode === 'dry') removeMem(s.id)
    else
      await db.transaction('rw', db.subjects, db.courseSlots, async () => {
        await db.subjects.delete(s.id)
        await db.courseSlots.where('subjectId').equals(s.id).delete()
      })
  }

  return (
    <div className="onb-step" key="s1">
      <h1 className="onb-h">이번 학기 과목</h1>
      <p className="meta mono">{list.length}</p>
      <div className="onb-input">
        <input
          ref={ref}
          className="tt-in"
          placeholder="과목 이름"
          aria-label="과목 이름"
          value={name}
          enterKeyHint="enter"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
        <div className="tt-colors" role="radiogroup" aria-label="색">
          {COLORS.map((c) => {
            const used = list.some((s) => s.color === c)
            return <button key={c} type="button" role="radio" aria-checked={pick === c} aria-label={c} disabled={used} className="tt-swatch" style={{ background: `var(--s-${c})` }} onClick={() => setColor(c)} />
          })}
        </div>
      </div>
      {list.length > 0 && (
        <ul className="onb-chips">
          {list.map((s) => (
            <li key={s.id} className="tt-chip">
              <i style={{ background: `var(--s-${s.color})` }} />
              {s.name}
              <button type="button" aria-label={`${s.name} 빼기`} onClick={() => void remove(s)}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" className={list.length ? 'btn-primary' : 'btn-ghost'} disabled={!list.length} onClick={onNext}>다음</button>
      </div>
    </div>
  )
}
