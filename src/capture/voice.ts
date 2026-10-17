/**
 * 음성 메모 녹음 (MediaRecorder → Blob). 보안 문맥(localhost·https)에서만 된다 — LAN http에서는 마이크가 막힐 수 있다.
 * 권한이 거부되면 기억해 두고(gyeol-mic=denied) 마이크 아이콘을 숨긴다. 설정 '처음 화면 다시 보기'와 무관.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const KEY = 'gyeol-mic'

function deniedBefore(): boolean {
  try {
    return localStorage.getItem(KEY) === 'denied'
  } catch {
    return false
  }
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && !deniedBefore()
}

function pickMime(): string | undefined {
  const list = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
  return list.find((m) => MediaRecorder.isTypeSupported?.(m))
}

export type VoiceState = 'idle' | 'rec' | 'denied'

export function useVoice() {
  const [state, setState] = useState<VoiceState>(() => (voiceSupported() ? 'idle' : 'denied'))
  const [ms, setMs] = useState(0)
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; t0: number; done: (v: { blob: Blob; ms: number } | null) => void } | null>(null)
  const tick = useRef(0)

  // 권한이 이미 거부돼 있으면 숨긴다
  useEffect(() => {
    let alive = true
    void navigator.permissions?.query?.({ name: 'microphone' as PermissionName }).then((p) => {
      if (alive && p.state === 'denied') setState('denied')
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const release = () => {
    clearInterval(tick.current)
    rec.current?.stream.getTracks().forEach((t) => t.stop())
    rec.current = null
  }

  const start = useCallback(async () => {
    if (rec.current || state === 'denied') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const r = { mr, stream, chunks: [] as Blob[], t0: performance.now(), done: (_v: { blob: Blob; ms: number } | null) => {} }
      mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data)
      mr.onstop = () => {
        const dur = performance.now() - r.t0
        const blob = new Blob(r.chunks, { type: mr.mimeType || mime || 'audio/webm' })
        r.done(blob.size ? { blob, ms: dur } : null)
      }
      rec.current = r
      mr.start(250)
      setMs(0)
      setState('rec')
      tick.current = window.setInterval(() => setMs(performance.now() - r.t0), 250)
    } catch (e) {
      if ((e as DOMException)?.name === 'NotAllowedError' || (e as DOMException)?.name === 'SecurityError') {
        try {
          localStorage.setItem(KEY, 'denied')
        } catch {
          /* noop */
        }
        setState('denied')
      } else setState('idle')
    }
  }, [state])

  const stop = useCallback(
    () =>
      new Promise<{ blob: Blob; ms: number } | null>((resolve) => {
        const r = rec.current
        if (!r) return resolve(null)
        r.done = (v) => {
          release()
          setState('idle')
          resolve(v)
        }
        r.mr.stop()
      }),
    [],
  )

  const cancel = useCallback(() => {
    const r = rec.current
    if (!r) return
    r.done = () => {}
    try {
      r.mr.stop()
    } catch {
      /* noop */
    }
    release()
    setState('idle')
  }, [])

  useEffect(() => () => release(), [])
  return { state, ms, start, stop, cancel }
}

/** 0:07 · 1:23 */
export function fmtSec(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
