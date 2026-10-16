import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMotionMode } from '../context'
import type { RevealTextProps } from '../types'

export const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)'
export const EASE_IN = 'cubic-bezier(.55, 0, 1, .45)'

const HIDDEN_RICH: CSSProperties = { transform: 'translateY(105%)', opacity: 0 }
const HIDDEN_CALM: CSSProperties = { opacity: 0 }

/**
 * 초점 문장 — 줄 마스크 안에서 105% → 0으로 올라온다(520ms ease-out, 줄 간격 stagger=90ms).
 * 한 줄이 lines의 한 항목이다. 한글은 글자 단위로 쪼개지 않는다.
 * swapKey가 바뀌면: 나가는 줄 180ms(위로) → 들어오는 줄 520ms.
 * 절제: opacity만 200ms. 끔: 즉시.
 */
export function RevealText({ lines, as, className, stagger = 90, delay = 0, trigger = 'mount', swapKey }: RevealTextProps) {
  const mode = useMotionMode()
  const rootRef = useRef<HTMLElement | null>(null)
  const latest = useRef({ lines, swapKey })
  latest.current = { lines, swapKey }
  const [shown, setShown] = useState({ key: swapKey, lines, n: 0 })
  const [armed, setArmed] = useState(trigger !== 'inView')
  const leaving = useRef(false)
  const firstIn = useRef(true)

  // 화면에 들어올 때 시작
  useEffect(() => {
    if (armed) return
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setArmed(true)
      return
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setArmed(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [armed])

  // swapKey가 바뀌면 나가는 줄 → 교체
  useEffect(() => {
    if (swapKey === shown.key || leaving.current) return
    const swapIn = () => {
      leaving.current = false
      setShown((s) => ({ key: latest.current.swapKey, lines: latest.current.lines, n: s.n + 1 }))
    }
    const root = rootRef.current
    if (mode === 'off' || !armed || !root) {
      swapIn()
      return
    }
    const spans = Array.from(root.querySelectorAll<HTMLElement>(':scope > .gx-ln > .gx-ln-i'))
    if (!spans.length) {
      swapIn()
      return
    }
    leaving.current = true
    const anims = spans.map((el) => {
      el.getAnimations().forEach((a) => a.finish())
      return mode === 'calm'
        ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'linear', fill: 'forwards' })
        : el.animate(
            [
              { transform: 'translateY(0)', opacity: 1 },
              { transform: 'translateY(-105%)', opacity: 0 },
            ],
            { duration: 180, easing: EASE_IN, fill: 'forwards' },
          )
    })
    let done = false
    const finish = () => {
      if (done) return
      done = true
      swapIn()
    }
    Promise.all(anims.map((a) => a.finished)).then(finish, finish)
    window.setTimeout(finish, 400) // 숨은 탭 등에서 애니메이션이 멈춰도 교체는 일어나게
  }, [swapKey, shown.key, mode, armed])

  // 들어오는 줄
  useLayoutEffect(() => {
    if (!armed) return
    const root = rootRef.current
    if (!root || mode === 'off') return
    const spans = Array.from(root.querySelectorAll<HTMLElement>(':scope > .gx-ln > .gx-ln-i'))
    const base = firstIn.current ? delay : 0
    firstIn.current = false
    spans.forEach((el, i) => {
      const d = base + i * stagger
      if (mode === 'calm') {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: Math.min(d, 120), easing: 'linear', fill: 'backwards' })
      } else {
        el.animate(
          [
            { transform: 'translateY(105%)', opacity: 0 },
            { opacity: 1, offset: 0.55 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          { duration: 520, delay: d, easing: EASE_OUT, fill: 'backwards' },
        )
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.n, armed])

  const renderLines = swapKey === shown.key ? lines : shown.lines
  const hidden = !armed && mode !== 'off' ? (mode === 'calm' ? HIDDEN_CALM : HIDDEN_RICH) : undefined
  return createElement(
    as ?? 'p',
    { ref: rootRef, className: className ? `gx-reveal ${className}` : 'gx-reveal' },
    renderLines.map((line, i) => (
      <span key={`${shown.n}-${i}`} className="gx-ln">
        <span className="gx-ln-i" style={hidden}>
          {line}
        </span>
      </span>
    )),
  )
}
