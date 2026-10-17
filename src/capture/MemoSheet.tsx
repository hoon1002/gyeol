/**
 * 1초 메모 칸 (design-m2 1장). RootLayout에 미리 마운트(inert + opacity 0)해 두고,
 * 여는 키·버튼 핸들러 안에서 같은 틱에 inert를 풀고 focus()를 부른다(React 렌더를 기다리지 않음).
 * 폰 = 키보드 바로 위 아래 시트(visualViewport), 태블릿·데스크톱 = 내용 영역 가운데 아래 떠 있는 칸.
 * 하늘은 어둡게 하지 않는다. 저장 피드백은 80ms 뒤 별가루(saveMemo가 부른다), 토스트 없음.
 */
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { useSubjects } from '@/db/hooks'
import { isTypingTarget, useIsPhone } from '@/shell/hooks'
import { useUi } from '@/stores/ui'
import { guessSubject, saveMemo } from './api'
import { closeMemoSheet, memoTimings, registerMemoSheet } from './open'
import { fmtSec, useVoice } from './voice'
import { uid } from '@/db/schema'

/** 손글씨 칸은 펜 대기 때만 지연 로드(첫 화면 번들에 잉크를 넣지 않는다) */
const loadInk = () => import('@/ink')
const InkPad = lazy(() => loadInk().then((m) => ({ default: m.InkPad })))
import { tip } from '@/shell/Tip'
import { pushLayer } from '@/shell/layers'
import { useHintCount } from '@/shell/hints'
import { IconChecklist, IconClose, IconMic, IconPen, IconPin, IconPlus, IconStop } from '@/shell/icons'
import { discardInkDraft, findInkDraft } from './inkDraft'
// 첫 펜 메모 버퍼(QA #25): 의존성 없는 작은 모듈이라 잉크 조각을 기다리지 않고 바로 붙인다
import { InkPadBuffer } from '@/ink/padbuffer'
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
  const [audio, setAudio] = useState<{ blob: Blob; ms: number } | null>(null)
  const [check, setCheck] = useState(false)
  /** ＋ 하나에서 펼쳐지는 종류 칸 (design-ink 8-2) */
  const [fan, setFan] = useState(false)
  const [pin, setPin] = useState(false)
  /** 펜으로 ＋를 눌렀다: 포커스를 주지 않는다(키보드 없음). 키를 치면 바로 글 상태 (design-ink 8-1) */
  const [penWait, setPenWait] = useState(false)
  /** 손글씨 초안: 메모 id(쪽 = pages.noteId 'memo:<id>'), 획 수, 칸 너비. 저장하기 전까지 남는다(초안 1개) */
  const [inkId, setInkId] = useState<string | null>(null)
  const [inkCount, setInkCount] = useState(0)
  const [padW, setPadW] = useState(0)
  const inkIdRef = useRef<string | null>(null)
  inkIdRef.current = inkId
  const discardTimer = useRef(0)
  const bufRef = useRef<InkPadBuffer | null>(null)
  /** 패드가 실제 획 수를 알려 줬는가(알기 전에 닫으면 초안을 지우지 않는다) */
  const [inkKnown, setInkKnown] = useState(false)
  const voice = useVoice()
  const ph = useHintCount('memo-ph', 3)
  const enterHint = useHintCount('memo-enter', 3)
  const phBump = useRef(ph.bump)
  const releaseLayer = useRef<(() => void) | null>(null)
  /** Esc(겹침 층 관리자): 녹음 중이면 취소, 아니면 칸을 닫는다(과목 목록은 자기 층) */
  const escRef = useRef<() => void | boolean>(() => {})
  phBump.current = ph.bump
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
    const doOpen = (initial: string | undefined, origin: Element | null, pen = false) => {
      const ta = taRef.current!
      layer.inert = false
      layer.classList.add('is-open')
      layer.removeAttribute('aria-hidden')
      setPenWait(pen)
      // 펜으로 열면 패드가 준비되기 전 점을 받아 두는 버퍼를 같은 틱에 붙인다
      if (pen && !bufRef.current) {
        const box = layer.querySelector('.memo-box') as HTMLElement | null
        if (box) bufRef.current = new InkPadBuffer(box)
      }
      if (initial !== undefined && initial !== '') {
        ta.value = initial
        setText(initial)
      }
      // 펜으로 열면 포커스를 주지 않는다(키보드가 올라오지 않게)
      if (!pen) {
        ta.focus({ preventScroll: true })
        const end = ta.value.length
        ta.setSelectionRange(end, end)
      } else (layer.querySelector('.memo-box') as HTMLElement | null)?.focus?.({ preventScroll: true })
      if (!openRef.current) {
        originRef.current = origin ?? document.activeElement
        phBump.current()
        releaseLayer.current?.()
        releaseLayer.current = pushLayer({ id: 'memo', close: () => escRef.current(), el: layer })
      }
      openRef.current = true
      setOpen(true)
    }
    const doClose = () => {
      if (!openRef.current) return
      openRef.current = false
      releaseLayer.current?.()
      releaseLayer.current = null
      layer.classList.remove('is-open')
      layer.setAttribute('aria-hidden', 'true')
      taRef.current?.blur()
      layer.inert = true
      setOpen(false)
      setPicker(false)
      // 펜 대기는 한 번 열 때만: 다음에 손가락으로 열면 글, 펜이면 다시 펜 대기(초안은 남는다)
      setPenWait(false)
      bufRef.current?.dispose()
      bufRef.current = null
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
    ;(layer as HTMLDivElement & { __open?: (via: Via, origin: Element | null, pen?: boolean) => void }).__open = (via, origin, pen) => {
      const t0 = performance.now()
      doOpen(undefined, origin, !!pen)
      record(via, t0, performance.now())
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      registerMemoSheet(null)
    }
  }, [])

  // 음성 10분 상한: 저절로 멈춘다(저장은 사용자가)
  useEffect(() => {
    if (voice.state !== 'rec' || voice.ms < 600_000) return
    void voice.stop().then((a) => a && setAudio(a))
  }, [voice])

  // 펜 대기 = 손글씨 칸(design-ink 8-1): 칸은 처음부터 커진 크기로 깔리고 펜 아래 그림은 움직이지 않는다
  useEffect(() => {
    if (!penWait || !open) return
    // 저장하지 않은 초안(획이 있는 'memo:' 쪽)이 있으면 그것을 다시 붙인다(M3-7)
    if (!inkIdRef.current) void findInkDraft().then((d) => setInkId((x) => x ?? d ?? uid('memo-')))
    const box = layerRef.current?.querySelector('.memo-box') as HTMLElement | null
    setPadW(Math.max(200, Math.round((box?.clientWidth ?? 360) - 32)))
    void loadInk()
  }, [penWait, open])

  // 비우기: 획 0으로 닫으면 초안 쪽을 정리한다
  useEffect(() => {
    if (open || !inkId || !inkKnown || inkCount > 0) return
    void discardInkDraft(inkId)
    setInkId(null)
    setInkKnown(false)
  }, [open, inkId, inkCount, inkKnown])
  useEffect(() => setInkKnown(false), [inkId])

  // 펜 대기 중 키를 치면 글 상태로 (아직 그린 것이 없을 때만)
  useEffect(() => {
    if (!penWait || inkCount > 0) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        setPenWait(false)
        requestAnimationFrame(() => taRef.current?.focus({ preventScroll: true }))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [penWait, inkCount])

  useEffect(() => {
    if (!penWait || !open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void submitRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [penWait, open])

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

  const submit = async () => {
    if (penWait && inkId && inkCount > 0) {
      void saveMemo(text.replace(/☐\s?/g, ''), { subjectId, ink: { memoId: inkId } })
      setInkId(null)
      setInkCount(0)
      setText('')
      setPenWait(false)
      setOverride(undefined)
      closeNow()
      return
    }
    let a = audio
    if (voice.state === 'rec') a = await voice.stop()
    const raw = check ? text.split('\n').map((l) => l.replace(/^☐\s?/, '')).join('\n') : text
    const p = photo
    if (!raw.trim() && !p && !a) {
      closeNow()
      return
    }
    void saveMemo(raw, { subjectId, photo: a ? null : p, audio: a, checklist: check && !!raw.trim(), pinned: pin })
    if (!phone) enterHint.bump()
    setText('')
    setPhoto(null)
    setAudio(null)
    setCheck(false)
    setFan(false)
    setPin(false)
    setPenWait(false)
    setOverride(undefined)
    if (taRef.current) taRef.current.value = ''
    closeNow()
  }

  /** 체크리스트: 줄마다 ☐ (저장할 때 '[ ] '로) */
  const toggleCheck = () => {
    setCheck((on) => {
      const next = !on
      setText((t) => (next ? (t ? t.split('\n').map((l) => (l.startsWith('☐') ? l : `☐ ${l}`)).join('\n') : '☐ ') : t.split('\n').map((l) => l.replace(/^☐\s?/, '')).join('\n')))
      return next
    })
    taRef.current?.focus({ preventScroll: true })
  }

  const closeNow = () => closeMemoSheet()
  const submitRef = useRef(submit)
  submitRef.current = submit

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 조합 중(한글)에는 Enter·Esc를 무시한다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
      return
    }
    if (check && e.key === 'Backspace') {
      const ta = e.currentTarget
      const before = ta.value.slice(0, ta.selectionStart)
      const lineStart = before.lastIndexOf('\n') + 1
      const line = ta.value.slice(lineStart).split('\n')[0] ?? ''
      // 빈 항목에서 Backspace = 그 항목을 지우고 윗줄 끝으로
      if (ta.selectionStart === ta.selectionEnd && !line.replace(/^☐\s?/, '').trim() && lineStart > 0) {
        e.preventDefault()
        const v = ta.value.slice(0, lineStart - 1) + ta.value.slice(lineStart + line.length)
        setText(v)
        requestAnimationFrame(() => ta.setSelectionRange(lineStart - 1, lineStart - 1))
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // 체크리스트: Enter = 새 항목, 빈 항목에서 Enter = 저장
      if (check) {
        const ta = e.currentTarget
        const before = ta.value.slice(0, ta.selectionStart)
        const lastLine = before.split('\n').pop() ?? ''
        if (lastLine.replace(/^☐\s?/, '').trim()) {
          const v = `${before}\n☐ ${ta.value.slice(ta.selectionEnd)}`
          setText(v)
          const pos = before.length + 3
          requestAnimationFrame(() => ta.setSelectionRange(pos, pos))
          return
        }
        setText(ta.value.split('\n').filter((l) => l.replace(/^☐\s?/, '').trim()).join('\n'))
      }
      void submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (picker) setPicker(false)
      else if (voice.state === 'rec') voice.cancel()
      else closeNow()
    }
  }

  escRef.current = () => {
    if (voice.state === 'rec') {
      voice.cancel()
      return false
    }
    closeMemoSheet()
  }

  const takeImage = (files: FileList | null | undefined): boolean => {
    const f = files ? Array.from(files).find((x) => x.type.startsWith('image/')) : undefined
    if (!f) return false
    setPhoto(f)
    setAudio(null)
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

  const canSave = !!text.replace(/☐/g, '').trim() || !!photo || !!audio || voice.state === 'rec'

  return (
    <div ref={layerRef} className="memo-layer" aria-hidden="true">
      <div className="memo-catch" onPointerDown={closeNow} />
      <div
        className="memo-box"
        tabIndex={-1}
        data-hand={penWait ? 'pen' : undefined}
        data-ink={penWait ? '' : undefined}
        role="dialog"
        aria-label="메모"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch' && (e.target as HTMLElement).closest('.memo-grip, .memo-swipe')) swipe.current = { y: e.clientY, id: e.pointerId }
        }}
        onPointerMove={(e) => {
          if (swipe.current && e.pointerId === swipe.current.id && e.clientY - swipe.current.y > 36) {
            swipe.current = null
            closeNow()
          }
        }}
        onPointerUp={() => (swipe.current = null)}
      >
        {/* 폰: 위쪽 가장자리 띠에서 아래로 쓸면 닫힌다(QA #16 · design-m2 1-2). 띠는 touch-action none이라 스크롤에 뺏기지 않는다 */}
        {phone && <span className="memo-swipe" aria-hidden="true" />}
        {phone && <span className="memo-grip" aria-hidden="true" />}
        <div className="memo-row">
          {thumb && !audio && (
            <span className="memo-thumb">
              <img src={thumb} alt="" />
              <button type="button" aria-label="사진 빼기" onClick={() => setPhoto(null)}>×</button>
            </span>
          )}
          {audio && voice.state !== 'rec' && (
            <span className="memo-voice inum" aria-label={`음성 ${fmtSec(audio.ms)}`}>
              <IconMic size={16} />
              {fmtSec(audio.ms)}
              <button type="button" aria-label="음성 빼기" onClick={() => setAudio(null)}>×</button>
            </span>
          )}
          {penWait && <span className="memo-pen" aria-hidden="true"><IconPen size={16} /></span>}
          <textarea
            ref={taRef}
            className={`memo-input${check ? ' is-check' : ''}`}
            style={penWait && !text ? { display: 'none' } : undefined}
            rows={1}
            placeholder={ph.fresh || (phone && !text) ? '생각 하나' : undefined}
            aria-label="메모"
            enterKeyHint={check ? 'enter' : 'done'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {/* 손글씨 메모(design-ink 8-1): 펜으로 ＋ → 칸이 위로 자라 잉크 칸. 쪽 = pages.noteId 'memo:<id>' */}
          {penWait && inkId && padW > 0 && (
            <div className="memo-ink" data-ink-slot="memo" style={{ height: phone ? 200 : 220 }}>
              <Suspense fallback={<div className="memo-ink-wait" />}>
                <InkPad memoId={inkId} width={padW} height={phone ? 200 : 220} pending={bufRef.current} onChange={(n) => { setInkCount(n); setInkKnown(true) }} />
              </Suspense>
            </div>
          )}
        </div>
        <div className="memo-foot">
          <div className="memo-chip-wrap">
            <button
              type="button"
              className="ibtn memo-dot"
              aria-haspopup="listbox"
              aria-expanded={picker}
              {...tip(subject ? subject.name : '과목 없음')}
              onClick={() => setPicker((v) => !v)}
            >
              <i className={`sdot is-lg${subject ? '' : ' is-none'}`} style={subject ? { ['--c' as string]: `var(--s-${subject.color})` } : undefined} />
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
          <div className="memo-tools">
            {voice.state === 'rec' && (
              <button type="button" className={`ibtn memo-mic is-rec${voice.ms >= 570_000 ? ' is-late' : ''}`} {...tip('녹음 멈춤')} onPointerDown={(e) => e.preventDefault()} onClick={async () => { const a = await voice.stop(); if (a) { setAudio(a); setPhoto(null) } }}>
                <IconStop size={18} />
                <span className="ibadge">{fmtSec(voice.ms)}</span>
              </button>
            )}
            {fan && (
              <span className="memo-fan" role="group" aria-label="메모 종류">
                <button type="button" className={`ibtn${check ? ' is-on' : ''}`} aria-pressed={check} {...tip('체크리스트')} onPointerDown={(e) => e.preventDefault()} onClick={() => { toggleCheck(); setFan(false) }}>
                  <IconChecklist size={20} />
                </button>
                <button type="button" className="ibtn memo-photo" {...tip('사진')} onPointerDown={(e) => e.preventDefault()} onClick={() => { setFan(false); fileRef.current?.click() }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                </button>
                <button type="button" className={`ibtn${pin ? ' is-on' : ''}`} aria-pressed={pin} {...tip(pin ? '고정 풀기' : '고정')} onPointerDown={(e) => e.preventDefault()} onClick={() => setPin((v) => !v)}>
                  <IconPin size={20} filled={pin} />
                </button>
                {/* 음성: 보안 주소가 아니거나 녹음기가 없으면 숨긴다(흐리게 두지 않는다) */}
                {voice.state === 'idle' && (
                  <button type="button" className="ibtn" {...tip('음성')} onPointerDown={(e) => e.preventDefault()} onClick={() => { setFan(false); void voice.start() }}>
                    <IconMic size={20} />
                  </button>
                )}
              </span>
            )}
            {pin && !fan && <span className="memo-pinned" aria-hidden="true"><IconPin size={14} filled /></span>}
            <button type="button" className={`ibtn memo-plus${fan ? ' is-open' : ''}`} aria-expanded={fan} {...tip(fan ? '접기' : '메모 종류')} onPointerDown={(e) => e.preventDefault()} onClick={() => setFan((v) => !v)}>
              <IconPlus size={20} />
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
            {penWait && inkId && (
              <button
                type="button"
                className="ibtn memo-ink-x"
                data-radial=""
                {...tip('닫기 · 길게 버리기')}
                onPointerDown={(e) => {
                  e.preventDefault()
                  const id = inkId
                  discardTimer.current = window.setTimeout(() => {
                    discardTimer.current = -1
                    void discardInkDraft(id)
                    setInkId(null)
                    setInkCount(0)
                    closeNow()
                  }, 500)
                }}
                onPointerUp={() => clearTimeout(discardTimer.current)}
                onPointerLeave={() => clearTimeout(discardTimer.current)}
                onClick={() => {
                  if (discardTimer.current === -1) return
                  closeNow()
                }}
              >
                <IconClose size={18} />
              </button>
            )}
            {penWait && inkCount > 0 ? (
              <button type="button" className="memo-send" {...tip('저장', { kbd: '⌘↵' })} onPointerDown={(e) => e.preventDefault()} onClick={() => void submit()}>↑</button>
            ) : phone ? (
              canSave && (
                <button type="button" className="memo-send" {...tip('저장')} onPointerDown={(e) => e.preventDefault()} onClick={() => void submit()}>↑</button>
              )
            ) : (
              enterHint.fresh && <kbd className="memo-hint" aria-hidden="true">↵</kbd>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 레일·독 ＋ 버튼: 클릭(사용자 제스처) 안에서 같은 틱에 연다 */
export function openMemoFromButton(origin: Element | null, pointerType?: string): void {
  const layer = document.querySelector('.memo-layer') as (HTMLDivElement & { __open?: (via: Via, origin: Element | null, pen?: boolean) => void }) | null
  // 입력한 손이 정한다(리더 결정 4): 펜으로 누르면 펜 대기(손글씨 메모 자리), 손가락·마우스·키보드면 글
  if (pointerType === 'pen') void import('@/ink')
  layer?.__open?.('button', origin, pointerType === 'pen')
}
