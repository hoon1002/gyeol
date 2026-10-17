/**
 * 설정 '데이터' 맨 위 보관 카드 — M3 조용한 판(design-quiet 1-8).
 * 늘 보이는 것: `10.12`(마지막 보관, 없으면 —) + 금빛 ⤓ 내보내기 + 조용한 ⤒ 가져오기. 개수는 툴팁.
 * 가져오기: 고르기(합치기 · 바꾸기 낱말만) → 바꾸기면 확인 한 문장(되돌릴 수 없는 일) → 끝 `+3 +1` 2초 + 하늘 D11.
 * fflate·백업 코드는 누를 때 불러온다(첫 화면 번들 보호).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useSkyEvent } from '@/fx'
import { db } from '@/db/schema'
import { fmtMD } from '@/lib/time'
import type { ImportMode, OpenedBackup } from '@/lib/backup'
import { IosInstallLine } from '@/onboarding/IosInstall'
import { tip } from '@/shell/Tip'
import { announce } from '@/shell/announce'
import { IconCheck, IconClose, IconDust, IconExport, IconImport, IconMerge, IconNote, IconReplace } from '@/shell/icons'
import { skyImportNotes } from './sky'

type St =
  | { k: 'idle' }
  | { k: 'busy' }
  | { k: 'pick'; b: OpenedBackup; mode: ImportMode }
  | { k: 'confirm'; b: OpenedBackup }
  | { k: 'done'; notes: number; memos: number; replaced: boolean }
  | { k: 'error' }

const load = () => import('@/lib/backup')

export function BackupCard() {
  const [st, setSt] = useState<St>({ k: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  const sky = useSkyEvent()
  const info = useLiveQuery(async () => {
    const [notes, memos, last] = await Promise.all([db.notes.filter((n) => !n.deletedAt).count(), db.memos.count(), db.meta.get('lastBackup')])
    return { notes, memos, last: last?.value as { at: number; notes: number; memos: number } | undefined }
  }, [])

  // 끝 표시는 2초 뒤 평소로
  useEffect(() => {
    if (st.k !== 'done') return
    const t = setTimeout(() => setSt({ k: 'idle' }), 2000)
    return () => clearTimeout(t)
  }, [st])

  const doExport = async () => {
    setSt({ k: 'busy' })
    try {
      await (await load()).exportAndSave()
      sky.glint('seat')
      announce('내보냈어요')
      setSt({ k: 'idle' })
    } catch {
      setSt({ k: 'error' })
    }
  }
  const doImport = async (b: OpenedBackup, mode: ImportMode) => {
    setSt({ k: 'busy' })
    try {
      const r = await (await load()).importBackup(b, mode)
      skyImportNotes(r.newNoteIds)
      const notes = mode === 'replace' ? (r.counts.notes ?? 0) : (r.added.notes ?? 0)
      const memos = mode === 'replace' ? (r.counts.memos ?? 0) : (r.added.memos ?? 0)
      announce(mode === 'replace' ? '바꿨어요' : `합쳤어요, 노트 ${notes}개 메모 ${memos}개 더함`)
      setSt({ k: 'done', notes, memos, replaced: mode === 'replace' })
    } catch {
      setSt({ k: 'error' })
    }
  }

  const last = info?.last
  const picker = (
    <input
      ref={input}
      type="file"
      accept=".zip,.gyeol.zip,application/zip"
      hidden
      onChange={async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        setSt({ k: 'busy' })
        try {
          setSt({ k: 'pick', b: await (await load()).openBackup(f), mode: 'merge' })
        } catch {
          setSt({ k: 'error' })
        }
      }}
    />
  )

  if (st.k === 'pick') {
    const m = st.b.manifest
    return (
      <div className="bk-card" role="group" aria-label="가져올 은하">
        <p className="bk-nums">
          <span className="mono">{fmtMD(m.exportedAt)}</span>
          <span className="inum" {...tip(`노트 ${m.counts.notes ?? 0}`)} tabIndex={0}><IconNote size={16} />{m.counts.notes ?? 0}</span>
          <span className="inum" {...tip(`메모 ${m.counts.memos ?? 0}`)} tabIndex={0}><IconDust size={16} />{m.counts.memos ?? 0}</span>
        </p>
        <div className="bk-radios" role="radiogroup" aria-label="가져오기 방식">
          {(
            [
              ['merge', '합치기', IconMerge],
              ['replace', '바꾸기', IconReplace],
            ] as const
          ).map(([v, t, I]) => (
            <label key={v} className="bk-radio">
              <input type="radio" name="bk-mode" checked={st.mode === v} onChange={() => setSt({ ...st, mode: v })} />
              <I size={18} />
              <span>{t}</span>
            </label>
          ))}
        </div>
        <div className="bk-acts">
          <button type="button" className="gold-btn" {...tip('가져오기')} onClick={() => (st.mode === 'replace' ? setSt({ k: 'confirm', b: st.b }) : void doImport(st.b, 'merge'))}>
            <IconCheck size={22} />
          </button>
          <button type="button" className="ibtn" {...tip('취소')} onClick={() => setSt({ k: 'idle' })}>
            <IconClose size={20} />
          </button>
        </div>
      </div>
    )
  }
  if (st.k === 'confirm') {
    // 되돌릴 수 없는 일: 문장 한 줄 + '바꾸기' 낱말(--danger). 금빛 버튼은 쓰지 않는다
    return (
      <div className="bk-card" role="group" aria-label="바꾸기 확인">
        <p className="bk-h">지금 은하를 지웁니다</p>
        <p className="bk-nums">
          <span className="inum"><IconNote size={16} />{info?.notes ?? 0}</span>
          <span className="inum"><IconDust size={16} />{info?.memos ?? 0}</span>
        </p>
        <div className="bk-acts">
          <button
            type="button"
            className="ibtn"
            {...tip('먼저 내보내기')}
            onClick={async () => {
              const b = st.b
              await doExport()
              setSt({ k: 'confirm', b })
            }}
          >
            <IconExport size={20} />
          </button>
          <button type="button" className="bk-danger" onClick={() => void doImport(st.b, 'replace')}>바꾸기</button>
          <button type="button" className="ibtn" {...tip('취소')} onClick={() => setSt({ k: 'idle' })}>
            <IconClose size={20} />
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="bk-card is-row" role="group" aria-label="내 은하 보관">
      <span className="mono bk-last" tabIndex={0} {...tip(last ? `노트 ${last.notes} · 메모 ${last.memos}` : '보관 없음')}>
        {st.k === 'done' ? (
          <>
            {!st.replaced && <><IconNote size={14} /> +{st.notes} <IconDust size={14} /> +{st.memos}</>}
            {st.replaced && <IconReplace size={14} />}
          </>
        ) : last ? (
          fmtMD(last.at)
        ) : (
          '—'
        )}
      </span>
      <div className="bk-acts">
        <button type="button" className="gold-btn" {...tip('내보내기')} disabled={st.k === 'busy'} onClick={() => void doExport()}>
          <IconExport size={22} />
        </button>
        <button type="button" className="ibtn" {...tip('가져오기')} disabled={st.k === 'busy'} onClick={() => input.current?.click()}>
          <IconImport size={20} />
        </button>
      </div>
      {st.k === 'error' && <p className="err-line">이 파일은 열 수 없어요.</p>}
      {picker}
      <IosInstallLine />
    </div>
  )
}
