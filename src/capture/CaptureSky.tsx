/** 하늘 다리 + 별가루 수 동기화(D2). RootLayout의 FieldProvider 안에 한 번 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { useSkyEvent } from '@/fx'
import { db } from '@/db/schema'
import { setSkyBridge, skyPinDust, skySetDust } from './sky'
import { sweepInkDrafts } from './inkDraft'

export function CaptureSky(): null {
  const ev = useSkyEvent()
  const inbox = useLiveQuery(() => db.memos.where('state').equals('inbox').count(), [])
  // 고정된 별가루(시작할 때 · 바뀔 때 상태를 맞춘다 — pinDust는 멱등)
  const pinned = useLiveQuery(async () => (await db.memos.where('state').equals('inbox').filter((m) => !!m.pinned).primaryKeys()).join(','), [])
  // 7일 지난 빈 손글씨 초안 쪽은 시작할 때 지운다(M3-7)
  useEffect(() => {
    const t = setTimeout(() => void sweepInkDrafts().catch(() => {}), 4000)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    setSkyBridge(ev)
    return () => setSkyBridge(null)
  }, [ev])
  useEffect(() => {
    if (inbox !== undefined) skySetDust(inbox)
  }, [ev, inbox])
  useEffect(() => {
    if (pinned) pinned.split(',').forEach((id) => skyPinDust(id, true))
  }, [ev, pinned])
  return null
}
