/**
 * 1초 메모 칸 (design-m2 1장). RootLayout에 미리 마운트(inert + opacity 0)해 두고,
 * 여는 키·버튼 핸들러 안에서 같은 틱에 inert를 풀고 focus()를 부른다(React 렌더를 기다리지 않음).
 * 폰 = 키보드 바로 위 아래 시트(visualViewport), 태블릿·데스크톱 = 내용 영역 가운데 아래 떠 있는 칸.
 * 하늘은 어둡게 하지 않는다. 저장 피드백은 80ms 뒤 별가루(saveMemo가 부른다), 토스트 없음.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { useSubjects } from '@/db/hooks'
import { isTypingTarget, useIsPhone } from '@/shell/hooks'
import { useUi } from '@/stores/ui'
import { guessSubject, saveMemo } from './api'
import { closeMemoSheet, memoTimings, registerMemoSheet } from './open'
import { SubjectPicker } from './SubjectPicker'
import '@/styles/capture.css'

type Via = 'key' | 'button' | 'api'

function record(via: Via, t0: number, focused: number) {
  const entry = { via, toFocus: +(focused - t0).toFixed(2), toFrame: null as number | null }
  memoTimings.push(entry)
  if (memoTimings.length > 20) memoTimings.shift()
  requestAnimationFrame(() => {
    entry.toFrame = +(performance.now() - t0).toFixed(2)
  })
  if (import.meta.env.DEV) (window as Window & { __gyeolMemo?: typeof memoTimings }).__gyeolMemo = memoTimings
}

/** 다른 층(⌘K · 설정 · 첫 실행)이 열려 있으면 n으로 열지 않는다 */
function blockedByLayer(): boolean {
  const ui = useUi.getState()
  return ui.paletteOpen || ui.settingsOpen || document.documentElement.hasAttribute('data-onboarding')
}

export function MemoSheet() {
  const layerRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const originRef = useRef<Element | null>(null)
  const openRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [override, setOverride] = useState<string | null | undefined>(undefined)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [picker, setPicker] = useState(false)
  const phone = useIsPhone()
  const subjects = useSubjects() ?? []

  const auto = useMemo(() => guessSubject(text, subjects), [text, subjects])
  const subjectId = override !== undefined ? override : (auto?.id ?? null)
  const subject = subjects.find((s) => s.id === subjectId) ?? null
  const thumb = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb) }, [thumb])

  // 손잡이: DOM을 바로 바꾼다 (같은 틱)
  useLayoutEffect(() => {
    const layer = layerRef.current!
    layer.inert = true
    const doOpen = (initial: string | undefined, origin: Element | null) => {
      const ta = taRef.current!
      layer.inert = false
      layer.classList.add('is-open')
      layer.removeAttribute('aria-hidden')
      if (initial !== undefined && initial !== '') {
        ta.value = initial
        setText(initial)
      }
      ta.focus({ preventScroll: true })
      const end = ta.value.length
      ta.setSelectionRange(end, end)
      if (!openRef.current) originRef.current = origin ?? document.activeElement
      openRef.current = true
      setOpen(true)
    }
    const doClose = () => {
      if (!openRef.current) return
      openRef.current = false
      layer.classList.remove('is-open')
      layer.setAttribute('aria-hidden', 'true')
      taRef.current?.blur()
      layer.inert = true
      setOpen(false)
      setPicker(false)
      const o = originRef.current as HTMLElement | null
      originRef.current = null
      if (o && o !== document.body && document.contains(o) && typeof o.focus === 'function') o.focus({ preventScroll: true })
    }
    registerMemoSheet({
      open: (initial, origin) => {
        const t0 = performance.now()
        doOpen(initial, origin)
        record('api', t0, performance.now())
      },
      close: doClose,
      isOpen: () => openRef.current,
    })
    // 단축키 n (글 입력 중이 아닐 때)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.repeat) return
      if (openRef.current || isTypingTarget(e.target) || blockedByLayer()) return
      e.preventDefault()
      doOpen(undefined, document.activeElement)
      record('key', e.timeStamp, performance.now())
    }
    window.addEventListener('keydown', onKey)
    ;(layer as HTMLDivElement & { __open?: (via: Via, origin: Element | null) => void }).__open = (via, origin) => {
      const t0 = performance.now()
      doOpen(undefined, origin)
      record(via, t0, performance.now())
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      registerMemoSheet(null)
    }
  }, [])

  // 폰: 키보드 바로 위 (visualViewport)
  useEffect(() => {
    if (!open || !phone) return
    const vv = window.visualViewport
    const layer = layerRef.current!
    if (!vv) return
    const fit = () => layer.style.setProperty('--kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`)
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
      layer.style.removeProperty('--kb')
    }
  }, [open, phone])

  // 높이 4줄까지
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 4 * 17 * 1.5 + 4)}px`
  }, [text])

  const submit = () => {
    const t = text
    const p = photo
    if (!t.trim() && !p) {
      closeNow()
      return
    }
    void saveMemo(t, { subjectId, photo: p })
    setText('')
    setPhoto(null)
    setOverride(undefined)
    if (taRef.current) taRef.current.value = ''
    closeNow()
  }

  const closeNow = () => closeMemoSheet()

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 조합 중(한글)에는 Enter·Esc를 무시한다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (picker) setPicker(false)
      else closeNow()
    }
  }

  const takeImage = (files: FileList | null | undefined): boolean => {
    const f = files ? Array.from(files).find((x) => x.type.startsWith('image/')) : undefined
    if (!f) return false
    setPhoto(f)
    return true
  }
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (takeImage(e.clipboardData?.files)) e.preventDefault()
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (takeImage(e.dataTransfer?.files)) e.preventDefault()
  }

  // 폰: 아래로 쓸어 닫기 (손잡이·머리에서)
  const swipe = useRef<{ y: number; id: number } | null>(null)

  const canSave = !!text.trim() || !!photo

  return (
    <div ref={layerRef} className="memo-layer" aria-hidden="true">
      <div className="memo-catch" onPointerDown={closeNow} />
      <div
        className="memo-box"
        role="dialog"
        aria-label="메모"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch' && (e.target as HTMLElement).closest('.memo-grip')) swipe.current = { y: e.clientY, id: e.pointerId }
        }}
        onPointerMove={(e) => {
          if (swipe.current && e.pointerId === swipe.current.id && e.clientY - swipe.current.y > 36) {
            swipe.current = null
            closeNow()
          }
        }}
        onPointerUp={() => (swipe.current = null)}
      >
        {phone && <span className="memo-grip" aria-hidden="true" />}
        <div className="memo-row">
          {thumb && (
            <span className="memo-thumb">
              <img src={thumb} alt="" />
              <button type="button" aria-label="사진 빼기" onClick={() => setPhoto(null)}>×</button>
            </span>
          )}
          <textarea
            ref={taRef}
            className="memo-input"
            rows={1}
            placeholder="생각 하나"
            aria-label="메모"
            enterKeyHint="done"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <button type="button" className="memo-photo" aria-label="사진" onClick={() => fileRef.current?.click()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            {...(phone ? { capture: 'environment' as const } : {})}
            hidden
            onChange={(e) => {
              takeImage(e.target.files)
              e.target.value = ''
              taRef.current?.focus({ preventScroll: true })
            }}
          />
        </div>
        <div className="memo-foot">
          <div className="memo-chip-wrap">
            <button type="button" className={`memo-chip${subject ? '' : ' is-none'}`} aria-haspopup="listbox" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>
              {subject && <i style={{ background: `var(--s-${subject.color})` }} aria-hidden="true" />}
              {subject ? subject.short || subject.name : '과목 없음'}
            </button>
            {picker && (
              <SubjectPicker
                subjects={subjects}
                value={subjectId}
                onPick={(id) => {
                  setOverride(id)
                  setPicker(false)
                  taRef.current?.focus({ preventScroll: true })
                }}
                onClose={() => setPicker(false)}
              />
            )}
          </div>
          {phone ? (
            canSave && (
              <button type="button" className="memo-send" aria-label="저장" onPointerDown={(e) => e.preventDefault()} onClick={submit}>↑</button>
            )
          ) : (
            <span className="memo-hint mono" aria-hidden="true">Enter 저장</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** 레일·독 ＋ 버튼: 클릭(사용자 제스처) 안에서 같은 틱에 연다 */
export function openMemoFromButton(origin: Element | null): void {
  const layer = document.querySelector('.memo-layer') as (HTMLDivElement & { __open?: (via: Via, origin: Element | null) => void }) | null
  layer?.__open?.('button', origin)
}
