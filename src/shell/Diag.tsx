/**
 * 진단 칸 (?diag=1): 하늘이 왜 3D가 아닌지 원격으로 알 수 있게 — 사용자가 사진을 찍어 보내거나 [복사]로 글을 보낸다.
 * 하늘 모드·이유 · GPU · WebGL2 · 확장 · 최대 텍스처 · 화면 · 메모리 · 코어 · 보안 컨텍스트 · UA · 3D 등급 · fps.
 * 주소에 diag=1이 없으면 아무것도 그리지 않는다.
 */
import { useEffect, useRef, useState } from 'react'
import { getSkyDiag } from '@/fx'

interface GlInfo {
  webgl2: boolean
  renderer: string
  maxTex: number
  ext: Record<string, boolean>
}

const EXTS = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_float_blend']

/** 따로 작은 WebGL2 컨텍스트를 잠깐 만들어 묻고 바로 놓는다(하늘 컨텍스트와 상관없이) */
function readGl(): GlInfo {
  try {
    const c = document.createElement('canvas')
    const g = c.getContext('webgl2')
    if (!g) return { webgl2: false, renderer: '-', maxTex: 0, ext: {} }
    const dbg = g.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null
    const renderer = String(dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER))
    const ext: Record<string, boolean> = {}
    const all = g.getSupportedExtensions() ?? []
    for (const n of EXTS) ext[n] = all.includes(n)
    const maxTex = Number(g.getParameter(g.MAX_TEXTURE_SIZE))
    ;(g.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext()
    return { webgl2: true, renderer, maxTex, ext }
  } catch (e) {
    return { webgl2: false, renderer: '오류: ' + String((e as Error)?.message ?? e).slice(0, 80), maxTex: 0, ext: {} }
  }
}

function textOf(gl: GlInfo): string {
  const sky = getSkyDiag()
  const nav = navigator as Navigator & { deviceMemory?: number }
  const ua = navigator.userAgent.replace(/Mozilla\/5\.0 /, '').replace(/ ?AppleWebKit\/[\d.]+ \(KHTML, like Gecko\)/, '').slice(0, 140)
  const yn = (b: boolean | undefined) => (b ? '있음' : '없음')
  return [
    `하늘: ${sky ? (sky.mode === '3d' ? '3D' : '2.5D') : '없음'}${sky?.reason ? ' — ' + sky.reason : ''}`,
    `3D 등급 ${sky?.tier ?? '-'} · ${sky?.fps != null ? sky.fps + 'fps' : '-'} · 전력 ${sky?.power ?? '-'}`,
    `GPU: ${gl.renderer}`,
    `WebGL2 ${gl.webgl2 ? '됨' : '안 됨'} · 최대 텍스처 ${gl.maxTex || '-'}`,
    ...EXTS.map((n) => `${n}: ${yn(gl.ext[n])}`),
    `화면 ${screen.width}×${screen.height} · 창 ${innerWidth}×${innerHeight} · DPR ${devicePixelRatio}`,
    `메모리 ${nav.deviceMemory ?? '-'}GB · 코어 ${navigator.hardwareConcurrency ?? '-'} · 보안 컨텍스트 ${isSecureContext ? '예' : '아니오'}`,
    `UA: ${ua}`,
  ].join('\n')
}

export function Diag() {
  const [on] = useState(() => new URLSearchParams(location.search).get('diag') === '1')
  const [gl] = useState<GlInfo | null>(() => (on ? readGl() : null))
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const pre = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!on || !gl) return
    const tick = () => setText(textOf(gl))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [on, gl])

  if (!on) return null

  const copy = async () => {
    try {
      if (navigator.clipboard && isSecureContext) {
        await navigator.clipboard.writeText(text)
        setNote('복사했습니다')
        return
      }
    } catch {
      /* 아래 방법으로 */
    }
    // 보안 컨텍스트가 아니면(LAN http) 글을 골라 두고 예전 방식으로 복사 — 안 되면 고른 채로 둔다
    const el = pre.current
    const sel = window.getSelection()
    if (el && sel) {
      sel.selectAllChildren(el)
      let ok = false
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
      setNote(ok ? '복사했습니다' : '글을 골라 두었습니다 — 길게 눌러 복사하세요')
    }
  }

  return (
    <div
      data-no-sky-drag=""
      role="status"
      aria-label="진단"
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 10000,
        maxWidth: 'min(94vw, 560px)',
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(8, 10, 18, 0.82)',
        color: '#F2F4F8',
        font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        boxShadow: '0 4px 18px rgba(0,0,0,.35)',
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    >
      <pre ref={pre} style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: 'inherit' }}>
        {text}
      </pre>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
        <button
          type="button"
          onClick={() => void copy()}
          style={{ padding: '6px 14px', borderRadius: 8, background: '#F2F4F8', color: '#0A0E19', font: '600 13px/1.2 system-ui, sans-serif' }}
        >
          복사
        </button>
        {note && <span style={{ font: '12px/1.4 system-ui, sans-serif', opacity: 0.85 }}>{note}</span>}
      </div>
    </div>
  )
}
