/** 하늘 다리 + 별가루 수 동기화(D2). RootLayout의 FieldProvider 안에 한 번 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { useSkyEvent } from '@/fx'
import { db } from '@/db/schema'
import { setSkyBridge, skySetDust } from './sky'

export function CaptureSky(): null {
  const ev = useSkyEvent()
  const inbox = useLiveQuery(() => db.memos.where('state').equals('inbox').count(), [])
  useEffect(() => {
    setSkyBridge(ev)
    return () => setSkyBridge(null)
  }, [ev])
  useEffect(() => {
    if (inbox !== undefined) skySetDust(inbox)
  }, [ev, inbox])
  return null
}
