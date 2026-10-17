/**
 * .ics 미리보기 시트 (design-m2 6-3): "수업 9개" / "매주 반복만" / [넣기]. 줄마다 체크(기본 켬) — 과목 · 요일 · 시각.
 * 매주 반복이 아닌 일정은 lib/ics가 이미 뺐다. 과목은 SUMMARY로 추정하거나 새로 만든다(timetable.importClasses).
 */
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseIcs, type IcsClass } from '@/lib/ics'
import { weekdayShort } from '@/lib/time'
import { importClasses, type TimetableStore } from './slots'
import { tip } from '@/shell/Tip'
import { IconCalendarIn, IconCheck, IconClose, IconPlan } from '@/shell/icons'
import '@/styles/capture.css'

/** 파일 고르기 버튼 + 미리보기 시트 */
export function IcsButton({ store, className = 'ibtn', label = '캘린더 파일', iconOnly = true, onDone, onPicked }: { store: TimetableStore; className?: string; label?: string; iconOnly?: boolean; onDone?: (n: number) => void; onPicked?: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [list, setList] = useState<IcsClass[] | null>(null)
  const [error, setError] = useState(false)
  return (
    <>
      {iconOnly ? (
        <button type="button" className={className} {...tip(label)} onClick={() => input.current?.click()}>
          <IconCalendarIn size={20} />
        </button>
      ) : (
        <button type="button" className={className} onClick={() => input.current?.click()}>
          <IconCalendarIn size={18} />
          {label}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          onPicked?.()
          try {
            setList(parseIcs(await f.text()))
            setError(false)
          } catch {
            setError(true)
          }
        }}
      />
      {error && <p className="err-line">이 파일은 열 수 없어요.</p>}
      {/* 시트는 body로 띄운다(변형된 조상 안에서 fixed가 갇히지 않게) */}
      {list && createPortal(<IcsPreview list={list} store={store} onClose={(n) => { setList(null); if (n !== null) onDone?.(n) }} />, document.body)}
    </>
  )
}

export function IcsPreview({ list, store, onClose }: { list: IcsClass[]; store: TimetableStore; onClose: (inserted: number | null) => void }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(list.map((c) => c.key)))
  const [busy, setBusy] = useState(false)
  const picked = list.filter((c) => on.has(c.key))
  const insert = async () => {
    setBusy(true)
    const n = await importClasses(picked, store)
    setBusy(false)
    onClose(n)
  }
  return (
    <div className="ics-layer" onKeyDown={(e) => e.key === 'Escape' && onClose(null)}>
      <div className="ics-catch" onClick={() => onClose(null)} />
      <div className="ics-sheet" role="dialog" aria-label="캘린더 파일 가져오기">
        <span className="sheet-grip" aria-hidden="true" />
        <h2 className="ics-h inum" aria-label={`매주 수업 ${list.length}개`}>
          <IconPlan size={20} />
          <span aria-hidden="true">{list.length}</span>
        </h2>
        {list.length > 0 && (
          <ul className="ics-list">
            {list.map((c) => (
              <li key={c.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={on.has(c.key)}
                    onChange={() =>
                      setOn((s) => {
                        const n = new Set(s)
                        if (n.has(c.key)) n.delete(c.key)
                        else n.add(c.key)
                        return n
                      })
                    }
                  />
                  <span className="ics-name">{c.summary}</span>
                  <span className="mono">{weekdayShort(c.weekday)} {c.start}–{c.end}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="ics-acts">
          <button type="button" className="gold-btn" {...tip('넣기')} disabled={!picked.length || busy} onClick={() => void insert()} autoFocus>
            <IconCheck size={22} />
          </button>
          <button type="button" className="ibtn" {...tip('취소')} onClick={() => onClose(null)}>
            <IconClose size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
