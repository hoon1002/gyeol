import { FRAG, VERT } from './shaders'

/** 셰이더에 넘기는 한 프레임의 값. 좌표는 모두 CSS px. */
export interface FrameUniforms {
  viewW: number
  viewH: number
  res: number
  time: number
  now: number
  step: number
  ax: number
  ay: number
  scale: number
  amp: number
  octaves: number
  knots: Float32Array // 4 × vec4
  knotR: number
  ripples: Float32Array // 4 × vec4
  rippleAcc: Float32Array // vec4
  phase: number
  glow: number
  tint: Float32Array // vec4
  rings: Float32Array // vec4
  seal: Float32Array // vec4
  sealBump: number
  dim: number
  minor: Float32Array // vec4
  major: Float32Array // vec4
  accent: Float32Array // vec3
}

const NAMES = [
  'uView', 'uPx', 'uRes', 'uTime', 'uNow', 'uStep', 'uAniso', 'uScale', 'uAmp', 'uOctaves',
  'uKnot', 'uKnotR', 'uRipple', 'uRippleAcc', 'uPhase', 'uGlow', 'uTint', 'uRings', 'uSeal',
  'uSealBump', 'uDim', 'uMinor', 'uMajor', 'uAccent',
] as const
type UName = (typeof NAMES)[number]

/**
 * 전체 화면 삼각형 1개 + 프래그먼트 셰이더 1개. 버퍼 없음(gl_VertexID).
 * 생성 실패(WebGL2 없음·컴파일 실패)는 throw → 엔진이 Canvas 2D 정지 프레임으로 대체.
 */
export class GLField {
  readonly gl: WebGL2RenderingContext
  private prog: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private loc = {} as Record<UName, WebGLUniformLocation | null>
  readonly renderer: string

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    })
    if (!gl) throw new Error('webgl2-unavailable')
    this.gl = gl
    this.renderer = GLField.rendererName(gl)
    this.init()
  }

  static rendererName(gl: WebGL2RenderingContext): string {
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
      return String(gl.getParameter(gl.RENDERER) ?? '')
    } catch {
      return ''
    }
  }

  /** 컨텍스트 복구 뒤에도 다시 부른다 */
  init(): void {
    const gl = this.gl
    if (gl.isContextLost()) throw new Error('context-lost')
    const vs = this.shader(gl.VERTEX_SHADER, VERT)
    const fs = this.shader(gl.FRAGMENT_SHADER, FRAG)
    const prog = gl.createProgram()
    if (!prog) throw new Error('program')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? ''
      gl.deleteProgram(prog)
      throw new Error('link: ' + log)
    }
    this.prog = prog
    this.vao = gl.createVertexArray()
    for (const n of NAMES) this.loc[n] = gl.getUniformLocation(prog, n)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl
    const s = gl.createShader(type)
    if (!s) throw new Error('shader')
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) ?? ''
      gl.deleteShader(s)
      throw new Error('compile: ' + log)
    }
    return s
  }

  get lost(): boolean {
    return this.gl.isContextLost()
  }

  draw(u: FrameUniforms): void {
    const gl = this.gl
    if (!this.prog || gl.isContextLost()) return
    const L = this.loc
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(L.uView, u.viewW, u.viewH)
    gl.uniform2f(L.uPx, this.canvas.width, this.canvas.height)
    gl.uniform1f(L.uRes, u.res)
    gl.uniform1f(L.uTime, u.time)
    gl.uniform1f(L.uNow, u.now)
    gl.uniform1f(L.uStep, u.step)
    gl.uniform2f(L.uAniso, u.ax, u.ay)
    gl.uniform1f(L.uScale, u.scale)
    gl.uniform1f(L.uAmp, u.amp)
    gl.uniform1i(L.uOctaves, u.octaves)
    gl.uniform4fv(L.uKnot, u.knots)
    gl.uniform1f(L.uKnotR, u.knotR)
    gl.uniform4fv(L.uRipple, u.ripples)
    gl.uniform4fv(L.uRippleAcc, u.rippleAcc)
    gl.uniform1f(L.uPhase, u.phase)
    gl.uniform1f(L.uGlow, u.glow)
    gl.uniform4fv(L.uTint, u.tint)
    gl.uniform4fv(L.uRings, u.rings)
    gl.uniform4fv(L.uSeal, u.seal)
    gl.uniform1f(L.uSealBump, u.sealBump)
    gl.uniform1f(L.uDim, u.dim)
    gl.uniform4fv(L.uMinor, u.minor)
    gl.uniform4fv(L.uMajor, u.major)
    gl.uniform3fv(L.uAccent, u.accent)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** 프로그램만 지운다. 컨텍스트는 버리지 않는다(StrictMode 재마운트 때 같은 캔버스를 다시 쓴다). */
  dispose(): void {
    const gl = this.gl
    if (!gl.isContextLost()) {
      if (this.prog) gl.deleteProgram(this.prog)
      if (this.vao) gl.deleteVertexArray(this.vao)
    }
    this.prog = null
    this.vao = null
  }

  /** 실험실용: 컨텍스트 손실 흉내 */
  simulateLoss(): boolean {
    const ext = this.gl.getExtension('WEBGL_lose_context')
    if (!ext) return false
    ext.loseContext()
    window.setTimeout(() => {
      try {
        ext.restoreContext()
      } catch {
        /* 이미 복구됨 */
      }
    }, 2500)
    return true
  }
}
