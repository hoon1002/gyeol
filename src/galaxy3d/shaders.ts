/**
 * 3D 은하 셰이더 (WebGL2). 층: 별(점, 가산) → 먼지(원반면 사각형, 곱하기 흡수) → 성운·팔 빛(가산) → 블룸 → 톤매핑.
 * 자전은 정점 셰이더가 시간으로 각도를 계산한다(차등 회전, 안쪽이 빠르다). 화면 전체 왜곡 없음.
 */
import { ARM_GLSL } from './galaxy'

const COMMON = /* glsl */ `
${ARM_GLSL}
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uTime;   // 은하 시계(초) — 회전 끔이면 멈춘다
uniform float uPx;     // 1 라디안당 화면 px (장치 px)
// design-v4 §3: 코어(r ≤ 3u) 1.2°/s, 바깥 Ω ∝ 1/r (15u에서 0.24°/s)
float omega(float r) { return 0.020943951 * 3.0 / max(3.0, r); }
vec3 diskPos(float r, float th0, float y) { float th = th0 + omega(r) * uTime; return vec3(r * cos(th), y, r * sin(th)); }
// 밀도파: 막대·팔 무늬·먼지·HII·젊은 별은 패턴 각속도 Ωp로 단단히 돈다 — 오래 켜 둬도 팔이 감기지 않는다
vec3 patPos(float r, float th0, float y) { float th = th0 + OMEGA_P * uTime; return vec3(r * cos(th), y, r * sin(th)); }
`

export const STAR_VS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform float uExpo;
uniform float uFocus;  // 초점 거리 (피사계 심도)
uniform float uDof;    // 흐림 세기
uniform float uDpr;
uniform vec2 uArm;    // 늙은 별 팔 밝기: 바탕 · 팔 (팔:팔 사이 ≈ 2–3 : 1)
uniform float uRest;   // 쉼 크로스페이드 0→1: 희미한 별 +20%
layout(location = 0) in vec4 a0;
layout(location = 1) in vec4 a1;
out vec3 vCol;
out float vSig;
out float vPx;
void main() {
  vec3 p;
  float kind = a1.w;
  float gain = 1.0;
  if (kind > 2.5 && kind < 3.5) {
    p = uCam + vec3(a0.x, a0.y, a0.z) * 400.0;   // 1층 먼 하늘: 카메라 중심 구(회전만 따라감)
  } else if (kind > 1.5 && kind < 2.5) {
    p = vec3(a0.x * cos(a0.y), a0.z, a0.x * sin(a0.y)); // 2층 헤일로: 거의 돌지 않는다
  } else if (kind > 0.5) {
    p = patPos(a0.x, a0.y, a0.z);                // 막대·젊은 별: 패턴과 함께
  } else {
    p = diskPos(a0.x, a0.y, a0.z);               // 늙은 별: 차등 회전
    // 지금 패턴 좌표에서 팔 위에 있으면 밝게 (별이 팔을 지나며 밝아졌다 어두워진다) + 패턴에 붙은 얼룩
    float phi = a0.y + (omega(a0.x) - OMEGA_P) * uTime;
    vec2 q = a0.x * vec2(cos(phi), sin(phi));
    float m = 1.0 + 0.22 * sin(q.x * 1.31 + q.y * 0.73) * sin(q.y * 1.07 - q.x * 0.41) + 0.14 * sin(q.x * 3.7 - q.y * 2.9) * sin(q.y * 3.3 + q.x * 1.9);
    gain = (uArm.x + uArm.y * oldArm(a0.x, phi)) * m;
  }
  vec4 clip = uVP * vec4(p, 1.0);
  float d = max(length(p - uCam), 0.02);
  bool sky = kind > 2.5 && kind < 3.5;
  float L = (sky ? a0.w * 24.0 : a0.w) * gain;
  float dd = sky ? 30.0 : d;
  // 빛의 양 = 밝기 / 거리² (가까이 갈수록 별은 커지지 않고 밝아진다)
  float flux = L / (dd * dd) * uExpo;
  // 피사계 심도: 초점에서 멀수록 번진다(빛의 총량은 같게)
  float coc = sky ? 0.0 : uDof * uPx * abs(1.0 / d - 1.0 / uFocus) * 0.004;
  float sig = max(0.55 * uDpr, min(coc, 9.0 * uDpr));
  float E = flux * 260.0;
  float peak = E / (6.2831853 * sig * sig);
  vec3 col = a1.rgb * peak;
  float mx = max(col.r, max(col.g, col.b));
  col *= 1.0 + 0.2 * uRest * (1.0 - smoothstep(0.08, 0.6, mx)); // 정지 장면: 3등급(희미한) 별 +20%
  mx = max(col.r, max(col.g, col.b));
  if (mx < 0.0015 || clip.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vSig = 1.0; vPx = 1.0; return; }
  // 아주 밝은 별: 중심은 1.0 안팎으로 누르고 남는 빛은 넓게 (블룸이 받는다)
  float k = mx > 3.0 ? 3.0 / mx : 1.0;
  vCol = col * k;
  vSig = sig / sqrt(k);
  vPx = min(ceil(vSig * 5.0) + 1.0, 40.0); // 점 크기 상한 40px (채우기 비용)
  gl_Position = clip;
  gl_PointSize = vPx;
}
`
export const STAR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
in float vSig;
in float vPx;
out vec4 o;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vPx;
  float g = exp(-dot(d, d) / (2.0 * vSig * vSig));
  o = vec4(vCol * g, 1.0);
}
`

/* 구름: 먼지·팔 빛은 원반면에 눕힌(팔 방향으로 길쭉한) 사각형, HII·팽대부 빛은 카메라를 보는 사각형 */
export const CLOUD_VS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uKindMin;
uniform float uKindMax;

layout(location = 0) in vec4 c0;
layout(location = 1) in vec4 c1;
out vec3 vCol;
out vec2 vUv;
void main() {
  float kind = c1.w;
  vec2 q = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vUv = q;
  if (kind < uKindMin - 0.5 || kind > uKindMax + 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  if (kind > 3.5) {
    // 먼 은하: 카메라 중심 하늘 구 위의 작은 타원 얼룩
    vec3 cc = uCam + c0.xyz * 350.0;
    vCol = c1.rgb;
    gl_Position = uVP * vec4(cc + (uRight * q.x + uUp * q.y * 0.42) * c0.w, 1.0);
    return;
  }
  vec3 c = patPos(c0.x, c0.y, c0.z); // 먼지·팔 빛·HII·막대 빛: 모두 패턴과 함께(밀도파)
  float s = c0.w;
  vec3 p;
  if (kind < 1.5) {
    float th = atan(c.z, c.x);
    vec3 rad = vec3(cos(th), 0.0, sin(th));
    vec3 tan_ = vec3(-sin(th), 0.0, cos(th));
    // 팔 방향(접선)으로 1.8배 길게, 팔 피치만큼 비스듬히
    vec3 along = normalize(tan_ - rad * 0.32); // 끌리는 팔(피치 18°) 방향
    vec3 across = normalize(cross(vec3(0.0, 1.0, 0.0), along));
    p = c + along * q.x * s * (kind < 0.5 ? 3.2 : 1.15) + across * q.y * s; // 먼지는 가늘고 긴 실, 빛은 거의 둥글게
  } else {
    p = c + (uRight * q.x + uUp * q.y) * s;
  }
  float d = length(c - uCam);
  // 카메라 바로 앞의 큰 구름은 흐려 사라진다(화면을 덮지 않게)
  float near = smoothstep(s * 1.5, s * 6.0, d);
  vCol = c1.rgb * near;
  gl_Position = uVP * vec4(p, 1.0);
}
`
export const CLOUD_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
in vec2 vUv;
uniform float uGain;
out vec4 o;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 3.2) - 0.04;
  o = vec4(max(vCol * g * uGain, 0.0), 1.0);
}
`

export const FULL_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`
/* 동적 해상도: 렌더 타깃은 전체 크기로 한 번 만들고, 상태에 따라 왼쪽 아래 일부(×0.75 · ×0.6)만 쓴다(재할당 0).
   그래서 원본을 읽을 때 uv에 uSrc.xy(쓴 비율)를 곱하고, uSrc.zw(쓴 영역 끝 − 반 텍셀)로 묶어 빈 곳을 읽지 않는다 */
const SRC = /* glsl */ `
uniform vec4 uSrc;
vec3 S(sampler2D t, vec2 uv) { return texture(t, min(uv, uSrc.zw)).rgb; }
`
/* 블룸: 13탭 내려 받기 → 텐트 올려 더하기 */
export const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
${SRC}
out vec4 o;
void main() {
  vec2 t = uTexel;
  vec2 u = vUv * uSrc.xy;
  vec3 a = S(uTex, u + t * vec2(-2, -2)), b = S(uTex, u + t * vec2(0, -2)), c = S(uTex, u + t * vec2(2, -2));
  vec3 d = S(uTex, u + t * vec2(-2, 0)), e = S(uTex, u), f = S(uTex, u + t * vec2(2, 0));
  vec3 g = S(uTex, u + t * vec2(-2, 2)), h = S(uTex, u + t * vec2(0, 2)), i = S(uTex, u + t * vec2(2, 2));
  vec3 j = S(uTex, u + t * vec2(-1, -1)), k = S(uTex, u + t * vec2(1, -1));
  vec3 l = S(uTex, u + t * vec2(-1, 1)), m = S(uTex, u + t * vec2(1, 1));
  vec3 s = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  o = vec4(min(s, vec3(64.0)), 1.0);
}
`
export const UP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uW;
${SRC}
out vec4 o;
void main() {
  vec2 t = uTexel;
  vec2 u = vUv * uSrc.xy;
  vec3 s = S(uTex, u) * 4.0;
  s += (S(uTex, u + vec2(-t.x, 0)) + S(uTex, u + vec2(t.x, 0)) + S(uTex, u + vec2(0, -t.y)) + S(uTex, u + vec2(0, t.y))) * 2.0;
  s += S(uTex, u - t) + S(uTex, u + t) + S(uTex, u + vec2(-t.x, t.y)) + S(uTex, u + vec2(t.x, -t.y));
  o = vec4(s / 16.0 * uW, 1.0);
}
`
/* 합성: 노출 · 블룸 · ACES 톤매핑 · 색보정(어둠은 남색, 빛은 금빛) · 비네트 · 디더. uRest: 정지 장면 코어 대비 +6% */
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec4 uSrc;     // 장면 쓴 비율·끝
uniform vec4 uSrcB;    // 블룸 쓴 비율·끝
uniform float uBloomK;
uniform float uExposure;
uniform float uAspect;
uniform float uRest;
out vec4 o;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = texture(uScene, min(vUv * uSrc.xy, uSrc.zw)).rgb + texture(uBloom, min(vUv * uSrcB.xy, uSrcB.zw)).rgb * uBloomK;
  c *= uExposure;
  c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(1.0 + 0.06 * uRest)); // 정지 장면: 대비 +6% (중간 회색 고정 → 밝기 그대로)
  // 바탕: 아주 깊은 남색
  c += vec3(0.004, 0.006, 0.014);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.12);
  vec3 t = aces(max(c, 0.0));
  t *= mix(vec3(0.94, 0.97, 1.06), vec3(1.04, 1.0, 0.92), smoothstep(0.05, 0.6, dot(t, vec3(0.333))));
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0);
  t *= 1.0 - 0.32 * pow(clamp(length(q) * 1.3, 0.0, 1.0), 2.4);
  t = pow(t, vec3(1.0 / 2.2));
  t += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(t, 1.0);
}
`

/* 반 해상도 구름 층을 장면에 얹기: 먼지 투과율(곱하기) · 성운 빛(더하기) */
export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uFloor;   // 먼지 투과율 하한: 사진의 먼지띠는 짙은 갈색이지 구멍 난 검정이 아니다
${SRC}
out vec4 o;
void main() { o = vec4(max(S(uTex, vUv * uSrc.xy), uFloor), 1.0); }
`

/* 4층 전경 별 (design-v4 §7-2): 카메라 둘레 반지름 uR 상자에 감싸 도는 3D 별 — 회전·비행 때 눈앞을 스쳐 간다.
   감싸기 기준 uFgCam은 속도 상한이 걸린 가상 카메라라, 화면 속도가 공전 ≤ 24px/s · 비행 ≤ 600px/s로 묶인다.
   보이는 개수·화면 점유는 CPU가 별마다 고른 가중치 aW로 지킨다(iPad ≤ 40 · 폰 ≤ 20, ≤ 1.5%).
   1u 안은 초점이 나간 원판(보케, 불투명도 ≤ 0.35), 크기 2–14px, 밝기 ≤ 55%, 글자·크롬 위에서는 × 0.15 */
export const FG_VS = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uFgCam;
uniform float uR;
uniform float uDpr;
uniform float uK;      // 밀도·밝기 (원반 안 1, 은하 밖 낮게)
uniform float uMaxPx;  // 14px (느리게 8px) × DPR
uniform vec4 uMask[6]; // 글자·크롬 구역 (NDC x0 y0 x1 y1)
uniform vec2 uFeather; // 24px 페더 (NDC)
layout(location = 0) in vec4 a0;   // 상자 안 위치(−R..R), 밝기
layout(location = 1) in vec4 a1;   // 색
layout(location = 2) in float aW;  // CPU가 고른 가중치 (0 = 안 보임)
out vec3 vCol;
out float vSig;
out float vPx;
void main() {
  vec3 rel = mod(a0.xyz - uFgCam + uR, 2.0 * uR) - uR;
  float d = length(rel);
  float fade = smoothstep(0.3, 0.6, d) * (1.0 - smoothstep(0.7 * uR, 0.98 * uR, d));
  vec4 clip = uVP * vec4(uCam + rel, 1.0);
  float flux = a0.w / (d * d) * uK * fade;
  float sig = 0.45 * uDpr + (d < 1.0 ? (1.0 - d) * 2.4 * uDpr : 0.0); // 1u 안에서만 보케
  sig = min(sig, uMaxPx / 5.0);
  float peak = flux * 40.0 / (6.2831853 * sig * sig);
  float cap = d < 1.0 ? mix(0.35, 0.55, d) : 0.55; // 보케 원판은 불투명도 ≤ 0.35, 가장 밝아도 55%
  vec3 col = a1.rgb * min(peak, cap) * aW;
  if (clip.w <= 0.0 || aW < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vSig = 1.0; vPx = 1.0; return; }
  vec2 n = clip.xy / clip.w;
  float inside = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 m = uMask[i];
    vec2 a = smoothstep(m.xy - uFeather, m.xy, n) * (1.0 - smoothstep(m.zw, m.zw + uFeather, n));
    inside = max(inside, a.x * a.y);
  }
  vCol = col * mix(1.0, 0.15, inside);
  vSig = sig;
  vPx = clamp(ceil(sig * 5.0) + 1.0, 2.0 * uDpr, uMaxPx);
  gl_Position = clip;
  gl_PointSize = vPx;
}
`
