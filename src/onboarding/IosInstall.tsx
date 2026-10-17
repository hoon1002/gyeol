/**
 * 아이폰 사파리 + 홈 화면 앱 아님(navigator.standalone === false)일 때만: "홈 화면에 추가하면 기록이 안전해요 ›".
 * 누르면 같은 자리에 2단계(공유 → 홈 화면에 추가). once = 첫 실행 마지막 단계에서 한 번만.
 */
import { useState } from 'react'

export function isIosSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  const ios = /iP(hone|od|ad)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  const safari = /Safari/.test(nav.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(nav.userAgent)
  return ios && safari && nav.standalone === false
}

export function IosInstallLine({ once = false }: { once?: boolean }) {
  const [open, setOpen] = useState(false)
  const [show] = useState(() => {
    if (!isIosSafariBrowser()) return false
    if (!once) return true
    try {
      if (localStorage.getItem('gyeol-ios-hint')) return false
      localStorage.setItem('gyeol-ios-hint', '1')
    } catch {
      /* 저장소 없음: 그냥 보인다 */
    }
    return true
  })
  if (!show) return null
  return (
    <div className="ios-line">
      <button type="button" className="quiet-line" aria-expanded={open} onClick={() => setOpen((v) => !v)}>홈 화면에 추가하면 기록이 안전해요 ›</button>
      {open && (
        <ol className="ios-steps mono">
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 11v8.5A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V11" /></svg>
            공유
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></svg>
            홈 화면에 추가
          </li>
        </ol>
      )}
    </div>
  )
}
