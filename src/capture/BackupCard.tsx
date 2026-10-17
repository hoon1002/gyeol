/**
 * 설정 시트 '데이터' 맨 위 보관 카드 (design-m2 8장): 내 은하 보관 / 마지막 10.12 · 노트 38 · 메모 12 / [내보내기] [가져오기].
 * 가져오기: 열기·검사 → 고르기(합치기 · 바꾸기) → 바꾸기면 확인 2단계(먼저 내보내기 권유) → 끝 한 줄.
 * fflate·백업 코드는 누를 때 불러온다(첫 화면 번들 보호).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { useSkyEvent } from '@/fx'
import { db } from '@/db/schema'
import { fmtMD } from '@/lib/time'
import type { ImportMode, OpenedBackup } from '@/lib/backup'
import { IosInstallLine } from '@/onboarding/IosInstall'
import { skyImportNotes } from './sky'

type St =
  | { k: 'idle'; note?: string }
  | { k: 'busy' }
  | { k: 'pick'; b: OpenedBackup; mode: ImportMode }
  | { k: 'confirm'; b: OpenedBackup }
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

  const doExport = async () => {
    setSt({ k: 'busy' })
    try {
      const m = await (await load()).exportAndSave()
      sky.glint('seat')
      setSt({ k: 'idle', note: `마지막 방금 · 노트 ${m.counts.notes ?? 0} · 메모 ${m.counts.memos ?? 0}` })
    } catch {
      setSt({ k: 'error' })
    }
  }
  const doImport = async (b: OpenedBackup, mode: ImportMode) => {
    setSt({ k: 'busy' })
    try {
      const r = await (await load()).importBackup(b, mode)
      skyImportNotes(r.newNoteIds)
      setSt({ k: 'idle', note: mode === 'replace' ? '바꿨어요' : `합쳤어요 · 노트 +${r.added.notes ?? 0} · 메모 +${r.added.memos ?? 0}` })
    } catch {
      setSt({ k: 'error' })
    }
  }

  const lastMeta = info?.last ? `마지막 ${fmtMD(info.last.at)} · 노트 ${info.last.notes} · 메모 ${info.last.memos}` : '아직 없음'
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
      <div className="bk-card">
        <p className="bk-h">가져올 은하</p>
        <p className="meta mono">{fmtMD(m.exportedAt)} · 노트 {m.counts.notes ?? 0} · 메모 {m.counts.memos ?? 0}</p>
        <div className="bk-radios" role="radiogroup" aria-label="가져오기 방식">
          {(
            [
              ['merge', '합치기', '같은 노트는 더 최근 것'],
              ['replace', '바꾸기', '지금 은하를 이것으로'],
            ] as const
          ).map(([v, t, h]) => (
            <label key={v} className="bk-radio">
              <input type="radio" name="bk-mode" checked={st.mode === v} onChange={() => setSt({ ...st, mode: v })} />
              <span>{t}</span>
              <small>{h}</small>
            </label>
          ))}
        </div>
        <div className="bk-acts">
          <button type="button" className="btn-primary small" onClick={() => (st.mode === 'replace' ? setSt({ k: 'confirm', b: st.b }) : void doImport(st.b, 'merge'))}>가져오기</button>
          <button type="button" className="btn-quiet" onClick={() => setSt({ k: 'idle' })}>취소</button>
        </div>
      </div>
    )
  }
  if (st.k === 'confirm') {
    return (
      <div className="bk-card">
        <p className="bk-h">지금 은하를 지웁니다</p>
        <p className="meta mono">노트 {info?.notes ?? 0} · 메모 {info?.memos ?? 0}</p>
        <div className="bk-acts">
          <button type="button" className="btn-ghost small" onClick={async () => {
            const b = st.b
            await doExport()
            setSt({ k: 'confirm', b })
          }}>먼저 내보내기</button>
          <button type="button" className="bk-danger" onClick={() => void doImport(st.b, 'replace')}>바꾸기</button>
          <button type="button" className="btn-quiet" onClick={() => setSt({ k: 'idle' })}>취소</button>
        </div>
      </div>
    )
  }
  return (
    <div className="bk-card">
      <p className="bk-h">내 은하 보관</p>
      <p className="meta mono">{st.k === 'idle' && st.note ? st.note : lastMeta}</p>
      {st.k === 'error' && <p className="err-line">이 파일은 열 수 없어요.</p>}
      <div className="bk-acts">
        <button type="button" className="btn-primary small" disabled={st.k === 'busy'} onClick={() => void doExport()}>내보내기</button>
        <button type="button" className="btn-ghost small" disabled={st.k === 'busy'} onClick={() => input.current?.click()}>가져오기</button>
      </div>
      {picker}
      <IosInstallLine />
    </div>
  )
}
