/**
 * 3D 은하 셰이더 (WebGL2). 층: 별(점, 가산) → 먼지(원반면 사각형, 곱하기 흡수) → 성운·팔 빛(가산) → 블룸 → 톤매핑.
 * 자전은 정점 셰이더가 시간으로 각도를 계산한다(차등 회전, 안쪽이 빠르다). 화면 전체 왜곡 없음.
 */
const COMMON = /* glsl */ `
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uTime;   // 은하 시계(초) — 회전 끔이면 멈춘다
uniform float uPx;     // 1 라디안당 화면 px (장치 px)
// design-v4 §3: 코어(r ≤ 3u) 1.2°/s, 바깥 Ω ∝ 1/r (15u에서 0.24°/s)
float omega(float r) { return 0.020943951 * 3.0 / max(3.0, r); }
vec3 diskPos(float r, float th0, float y) { float th = th0 + omega(r) * uTime; return vec3(r * cos(th), y, r * sin(th)); }
// 막대·팽대부는 단단히(코어 속도로) 돈다 — 막대 모양이 비틀리지 않게
vec3 barPos(float r, float th0, float y) { float th = th0 + 0.020943951 * uTime; return vec3(r * cos(th), y, r * sin(th)); }
`

export const STAR_VS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform float uExpo;
uniform float uFocus;  // 초점 거리 (피사계 심도)
uniform float uDof;    // 흐림 세기
uniform float uDpr;
uniform float uPar;    // 깊이 층 시차 (비행 중에만)
layout(location = 0) in vec4 a0;
layout(location = 1) in vec4 a1;
out vec3 vCol;
out float vSig;
out float vPx;
void main() {
  vec3 p;
  float kind = a1.w;
  if (kind > 2.5) {
    p = uCam + vec3(a0.x, a0.y, a0.z) * 400.0;   // 먼 하늘: 카메라 중심 구
  } else if (kind > 0.5 && kind < 1.5) {
    p = barPos(a0.x, a0.y, a0.z);
  } else {
    p = diskPos(a0.x, a0.y, a0.z);
  }
  vec4 clip = uVP * vec4(p, 1.0);
  float d = max(length(p - uCam), 0.02);
  float L = kind > 2.5 ? a0.w * 40.0 : a0.w;
  float dd = kind > 2.5 ? 30.0 : d;
  // 빛의 양 = 밝기 / 거리² (가까이 갈수록 별은 커지지 않고 밝아진다)
  float flux = L / (dd * dd) * uExpo;
  // 피사계 심도: 초점에서 멀수록 번진다(빛의 총량은 같게)
  float coc = kind > 2.5 ? 0.0 : uDof * uPx * abs(1.0 / d - 1.0 / uFocus) * 0.004;
  float sig = max(0.55 * uDpr, min(coc, 9.0 * uDpr));
  float E = flux * 260.0;
  float peak = E / (6.2831853 * sig * sig);
  vec3 col = a1.rgb * peak;
  float mx = max(col.r, max(col.g, col.b));
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
  vec3 c = kind > 2.5 ? barPos(c0.x, c0.y, c0.z) : diskPos(c0.x, c0.y, c0.z);
  float s = c0.w;
  vec3 p;
  if (kind < 1.5) {
    float th = atan(c.z, c.x);
    vec3 rad = vec3(cos(th), 0.0, sin(th));
    vec3 tan_ = vec3(-sin(th), 0.0, cos(th));
    // 팔 방향(접선)으로 1.8배 길게, 팔 피치만큼 비스듬히
    vec3 along = normalize(tan_ + rad * 0.24);
    vec3 across = normalize(cross(vec3(0.0, 1.0, 0.0), along));
    p = c + along * q.x * s * (kind < 0.5 ? 3.6 : 1.6) + across * q.y * s; // 먼지는 가늘고 긴 실
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
/* 블룸: 13탭 내려 받기 → 텐트 올려 더하기 */
export const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uTex, vUv + t * vec2(-2, -2)).rgb, b = texture(uTex, vUv + t * vec2(0, -2)).rgb, c = texture(uTex, vUv + t * vec2(2, -2)).rgb;
  vec3 d = texture(uTex, vUv + t * vec2(-2, 0)).rgb, e = texture(uTex, vUv).rgb, f = texture(uTex, vUv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uTex, vUv + t * vec2(-2, 2)).rgb, h = texture(uTex, vUv + t * vec2(0, 2)).rgb, i = texture(uTex, vUv + t * vec2(2, 2)).rgb;
  vec3 j = texture(uTex, vUv + t * vec2(-1, -1)).rgb, k = texture(uTex, vUv + t * vec2(1, -1)).rgb;
  vec3 l = texture(uTex, vUv + t * vec2(-1, 1)).rgb, m = texture(uTex, vUv + t * vec2(1, 1)).rgb;
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
out vec4 o;
void main() {
  vec2 t = uTexel;
  vec3 s = texture(uTex, vUv).rgb * 4.0;
  s += (texture(uTex, vUv + vec2(-t.x, 0)).rgb + texture(uTex, vUv + vec2(t.x, 0)).rgb + texture(uTex, vUv + vec2(0, -t.y)).rgb + texture(uTex, vUv + vec2(0, t.y)).rgb) * 2.0;
  s += texture(uTex, vUv - t).rgb + texture(uTex, vUv + t).rgb + texture(uTex, vUv + vec2(-t.x, t.y)).rgb + texture(uTex, vUv + vec2(t.x, -t.y)).rgb;
  o = vec4(s / 16.0 * uW, 1.0);
}
`
/* 합성: 노출 · 블룸 · ACES 톤매핑 · 색보정(어둠은 남색, 빛은 금빛) · 비네트 · 디더 */
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomK;
uniform float uExposure;
uniform float uAspect;
out vec4 o;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomK;
  c *= uExposure;
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
out vec4 o;
void main() { o = vec4(texture(uTex, vUv).rgb, 1.0); }
`

/* 전경 별: 카메라 둘레 반지름 uR 안에 감싸 도는 3D 별 — 회전·비행 때 눈앞을 스쳐 간다.
   가까울수록 밝고 조금 크게(약한 보케), 아주 가까우면·가장자리에서는 사라진다(감쌀 때 튀지 않게). 크기 상한 22px */
export const FG_VS = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uR;
uniform float uPx;
uniform float uDpr;
uniform float uK;      // 밀도·밝기 (원반 안 1, 은하 밖 낮게)
layout(location = 0) in vec4 a0;   // 상자 안 위치(−R..R), 밝기
layout(location = 1) in vec4 a1;   // 색
out vec3 vCol;
out float vSig;
out float vPx;
void main() {
  vec3 rel = mod(a0.xyz - uCam + uR, 2.0 * uR) - uR;
  float d = length(rel);
  float fade = smoothstep(0.3, 0.6, d) * (1.0 - smoothstep(0.7 * uR, 0.98 * uR, d));
  vec4 clip = uVP * vec4(uCam + rel, 1.0);
  float flux = a0.w / (d * d) * uK * fade;
  float sig = 0.45 * uDpr + (d < 1.0 ? (1.0 - d) * 2.4 * uDpr : 0.0); // 1u 안에서만 약한 보케 (2–14px)
  float peak = flux * 40.0 / (6.2831853 * sig * sig);
  vec3 col = a1.rgb * min(peak, 0.55); // 밝기 ≤ 55%
  if (clip.w <= 0.0 || max(col.r, max(col.g, col.b)) < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vSig = 1.0; vPx = 1.0; return; }
  vCol = col;
  vSig = sig;
  vPx = clamp(ceil(sig * 5.0) + 1.0, 2.0 * uDpr, 14.0 * uDpr); // 2–14px
  gl_Position = clip;
  gl_PointSize = vPx;
}
`
