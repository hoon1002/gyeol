/**
 * 은하수 셰이더 (WebGL2 / GLSL ES 3.00) — design-v3 §2 수치를 따른다.
 *
 * 정적 층(앱 시작·화면 크기 변경 때만 한 번 굽는다, 선형 HDR): 희미한 별 4등급 → S0, 3등급 → S1, 흐린 빛 B0·B1,
 *   합성 → L0(띠 빛 rgb · 먼지 D), L1(별빛 rgb · 3등급 휘도). 장면(노출·색조·안전 구역)과 무관하다.
 * 동적 층(매 프레임): PRESENT가 L0·L1을 장면 유니폼으로 노출·톤매핑·색보정·안전 구역 처리(화면 전환에 굽기 0회)
 *   + 0~2등급 별(반짝임은 일부만, 밝기만) + 별가루 + 유성.
 * 화면 전체를 움직이는 것은 없다(회전·확대·패럴랙스·왜곡 0). 글자 안전 구역 안은 하늘을 #161C2C 이하로 누른다.
 */

/* 띠 좌표계: 월드(x 0..aspect, y 0..1 아래로) ↔ 띠(s 길이 0..1, t 폭 단위, −t = 띠의 아래쪽 가장자리) */
const BAND = /* glsl */ `
uniform float uAspect;
uniform vec4 uBandA;   // ax, ay, dx, dy
uniform vec4 uBandB;   // nx, ny, len, w0
uniform float uBend;
uniform float uCore;
uniform float uCoreLen;
uniform vec4 uSafe[3]; // uv x0, y0, x1, y1
uniform vec2 uView;    // css px
uniform vec4 uCam;     // 카메라: 월드 uv 가운데 x, y, 줌, 시차(비행 중 0..1)
float widen(float s) {
  // 쏟아지며 퍼진다: 아래로 갈수록 넓게
  float k = clamp((s - 0.2) / 0.8, 0.0, 1.0);
  return (0.88 + 0.5 * k * k * (3.0 - 2.0 * k)) * (1.0 + 0.06 * sin(s * 9.0 + 1.3));
}
float bendOff(float s) { return uBend * uBandB.z * 4.0 * s * (1.0 - s); }
vec2 bandToWorld(float s, float t) {
  float off = t * uBandB.w * widen(s) + bendOff(s);
  return uBandA.xy + uBandA.zw * s * uBandB.z + uBandB.xy * off;
}
vec2 worldToBand(vec2 p) {
  vec2 q = p - uBandA.xy;
  float s = dot(q, uBandA.zw) / uBandB.z;
  float t = (dot(q, uBandB.xy) - bendOff(s)) / (uBandB.w * widen(s));
  return vec2(s, t);
}
/* 월드 uv → 화면 uv (줌·평행 이동만, 회전 없음). zm = 깊이 층 시차 배수 */
vec2 camUV(vec2 wuv, float zm) { return (wuv - uCam.xy) * (uCam.z * zm) + 0.5; }
vec2 worldUV(vec2 suv) { return (suv - 0.5) / uCam.z + uCam.xy; }
vec4 worldToClipZ(vec2 p, float zm) {
  vec2 uv = camUV(vec2(p.x / uAspect, p.y), zm);
  return vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}
vec4 worldToClip(vec2 p) { return worldToClipZ(p, 1.0); }
/* 선형 HDR 저장: 부동소수 렌더 타깃이 없으면 RGBA8에 sqrt(x/4)로 담는다 */
#ifndef HDR
#define HDR 1
#endif
vec3 encL(vec3 x) {
#if HDR
  return x;
#else
  return sqrt(clamp(x / 4.0, 0.0, 1.0));
#endif
}
vec3 decL(vec3 x) {
#if HDR
  return x;
#else
  return x * x * 4.0;
#endif
}
/* 글자 안전 구역 마스크 (가장자리 feather css px) */
float safeMaskR(vec2 uv, float feather, vec4 R[3]) {
  vec2 px = uv * uView;
  float m = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 r = R[i] * vec4(uView, uView);
    if (r.z > r.x) {
      // 사각형까지의 부호 거리(안쪽 음수) → 상자처럼 보이지 않게 넓고 둥글게 번진다
      vec2 c = (r.xy + r.zw) * 0.5;
      vec2 hsz = (r.zw - r.xy) * 0.5;
      vec2 q = abs(px - c) - hsz + feather * 0.5;
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - feather * 0.5;
      m = max(m, 1.0 - smoothstep(-feather * 0.6, feather, d));
    }
  }
  return m;
}
float safeMask(vec2 uv, float feather) { return safeMaskR(uv, feather, uSafe); }
`

const NOISE = /* glsl */ `
// 2D simplex noise — Ian McEwan, Ashima Arts (MIT License)
vec3 permute3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * snoise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
float ridged(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { float n = 1.0 - abs(snoise(p)); s += a * n * n; p = p * 2.07 + vec2(5.3, 1.1); a *= 0.52; }
  return s;
}
`

export const FULL_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);   // y 아래로
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

/* ---------- 정적: 3·4등급 별 → S ---------- */
export const STAR_STATIC_VS = /* glsl */ `#version 300 es
precision highp float;
${BAND}
uniform float uRes;
uniform float uFaint;     // 3등급 보이는 비율
uniform float uStarExpo;
uniform float uStill;     // 정지 장면: 3등급 +20%
in float aKind;
in vec2 aPos;
in float aL;
in vec3 aCol;
out vec3 vCol;
out float vSig;
out float vPx;
out float vPart;
void main() {
  vec2 p = aKind < 0.5 ? bandToWorld(aPos.x, aPos.y) : vec2(aPos.x * uAspect, aPos.y);
  float L = aL;
  vPart = L < 1.0 ? 0.0 : 1.0;
  // 3등급 10–35%, 4등급(분해 안 됨) 3–10% — 몸통의 결을 만든다
  float a = L < 1.0 ? 0.03 + 0.07 * L : (0.1 + 0.25 * clamp((L - 1.0) / 4.0, 0.0, 1.0)) * uFaint * (1.0 + 0.2 * uStill);
  a *= uStarExpo;
  vSig = max(0.36 * uRes, 0.55);
  vPx = ceil(vSig * 6.0) + 1.0;
  vCol = aCol * a;
  gl_Position = worldToClip(p);
  gl_PointSize = vPx;
}
`
export const STAR_STATIC_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
in float vSig;
in float vPx;
in float vPart;
layout(location = 0) out vec4 o0;   // 4등급 (분해 안 됨)
layout(location = 1) out vec4 o1;   // 3등급 (장면마다 보이는 비율이 다르다)
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vPx;
  float g = exp(-dot(d, d) / (2.0 * vSig * vSig));
  vec3 c = vCol * g;
  o0 = vec4(vPart < 0.5 ? c : vec3(0.0), 0.0);
  o1 = vec4(vPart > 0.5 ? c : vec3(0.0), 0.0);
}
`

/* ---------- 정적: 흐림 (분해 안 된 별빛) ---------- */
export const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uTex2;
uniform vec2 uTexel;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec3 down(sampler2D t, vec2 uv) {
  return (texture(t, uv + uTexel * vec2(-1.0, -1.0)).rgb + texture(t, uv + uTexel * vec2(1.0, -1.0)).rgb
        + texture(t, uv + uTexel * vec2(-1.0, 1.0)).rgb + texture(t, uv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  o0 = vec4(down(uTex, uv), 1.0);
  o1 = vec4(down(uTex2, uv), 1.0);
}
`
export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uTex2;
uniform vec2 uDir;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec3 blur(sampler2D t, vec2 uv) {
  vec3 c = texture(t, uv).rgb * 0.2270270270;
  c += (texture(t, uv + uDir * 1.3846153846).rgb + texture(t, uv - uDir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(t, uv + uDir * 3.2307692308).rgb + texture(t, uv - uDir * 3.2307692308).rgb) * 0.0702702703;
  return c;
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  o0 = vec4(blur(uTex, uv), 1.0);
  o1 = vec4(blur(uTex2, uv), 1.0);
}
`

/* ---------- 정적: 합성 → STATIC (rgb 색, a 감쇠) ---------- */
export const COMPOSE_FS = /* glsl */ `#version 300 es
precision highp float;
${BAND}
${NOISE}
in vec2 vUv;
uniform sampler2D uStars;
uniform sampler2D uStars3;
uniform sampler2D uBlur;
uniform sampler2D uBlur3;
uniform float uNebula;
uniform float uDust;
uniform float uStill;
uniform float uSeed;
layout(location = 0) out vec4 o0;   // 띠 빛 (노출 전, 먼지 반영) · a = 먼지 D
layout(location = 1) out vec4 o1;   // 별빛 (4+3등급) · a = 3등급 휘도
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
/* 띠 안의 미세한 별 (분해되는 별빛의 결) — css px 격자마다 별 하나일 확률 prob */
float microStars(vec2 px, float cell, float prob, float maxB) {
  vec2 g = floor(px / cell);
  vec2 f = px / cell - g;
  if (hash12(g + 0.37) > prob) return 0.0;
  vec2 pos = 0.2 + 0.6 * vec2(hash12(g + 13.1), hash12(g + 71.7));
  vec2 d = (f - pos) * cell;
  float b = pow(hash12(g + 5.3), 3.5) * maxB;
  return b * exp(-dot(d, d) / (2.0 * 0.4 * 0.4));
}
/* 리지드 멀티프랙탈 — 실 같은 먼지띠 */
float ridgedMF(vec2 p) {
  float sum = 0.0, freq = 1.0, amp = 0.55, prev = 1.0;
  for (int i = 0; i < 6; i++) {
    float n = 1.0 - abs(snoise(p * freq + float(i) * 7.3));
    n = n * n;
    sum += n * amp * prev;
    prev = clamp(n * 1.5, 0.0, 1.0);
    freq *= 2.07;
    amp *= 0.5;
  }
  return sum;
}
void main() {
  vec2 tuv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 uv = worldUV(vUv);   // 굽기 틀(화면보다 넓다) → 월드
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec2 pxc = uv * uView;
  vec2 bt = worldToBand(p);
  float s = bt.x;
  float t = bt.y;
  float len = uBandB.z;
  float w0 = uBandB.w;
  float wl = w0 * widen(s);
  vec2 sd = vec2(uSeed * 3.7, uSeed * 1.9);

  // 축을 따라: 진입 → 위쪽 1/3 코어 → 몸통 → 꼬리 (꼬리도 끝까지 보이게 40%)
  float prof = mix(0.62, 1.0, smoothstep(0.0, 0.17, s));
  prof = mix(prof, 0.74, smoothstep(0.32, 0.55, s));
  prof = mix(prof, 0.42, smoothstep(0.55, 1.0, s));
  float endF = smoothstep(-0.12, 0.0, s) * (1.0 - smoothstep(1.06, 1.25, s));

  // 띠 방향으로 늘린 좌표 + 도메인 왜곡 → 별구름과 먼지가 강물처럼 축을 따라 흐른다
  vec2 bq = vec2(s * len / w0 * 0.5, t) + sd;
  vec2 wq = bq + 0.42 * vec2(fbm(bq * vec2(1.1, 0.8)), fbm(bq * vec2(1.1, 0.8) + vec2(5.2, 1.3)));

  // 몸통 · 여러 스케일의 별구름
  float body = exp(-0.5 * t * t / 0.7);
  float c1 = fbm(wq * vec2(0.8, 1.0) + 3.0);
  float c2 = fbm(wq * vec2(2.3, 2.6) + 11.0);
  float c3 = fbm(wq * vec2(5.6, 6.2) + 23.0);
  float clump = clamp(0.62 + 0.33 * c1 + 0.19 * c2 + 0.1 * c3, 0.15, 1.5);
  float cloud = smoothstep(0.0, 1.0, 0.45 * c1 + 0.27 * c2);   // 대비 40% 낮춤 (연기 느낌 줄이기)   // 밝은 별구름 덩어리
  float dens = body * clump * prof;
  float haze = exp(-0.5 * t * t / 2.2);

  // 코어: 축 방향으로 1.7:1 늘린 타원 + 노이즈 (정원 금지)
  float hw = w0 * 1.25;
  float da = (s - uCore) * len / (1.7 * hw);
  float dp = (t * wl) / hw;
  float coreN = 0.86 + 0.28 * fbm(vec2(da, dp) * 1.7 + sd + vec2(4.0, 2.0));
  float coreE = exp(-(da * da + dp * dp) * 0.95) * coreN;
  float coreWide = exp(-(da * da * 0.22 + dp * dp * 0.3));

  // 색 — 장노출 은하수 사진의 팔레트 (호박빛 코어 · 크림빛 별구름 · 차가운 외곽)
  vec3 amber1 = vec3(0.95, 0.76, 0.48);      // 금빛 hsl(36°, 72%, 72%) — 초록 성분을 낮춰 카키 제거
  vec3 amber2 = vec3(0.92, 0.66, 0.42);
  vec3 apricot = vec3(0.904, 0.605, 0.456);  // 살구 hsl(20°, 70%, 68%)
  vec3 cream = vec3(1.0, 0.962, 0.9);
  vec3 coolW = vec3(0.56, 0.69, 0.96);
  vec3 teal1 = vec3(0.46, 0.593, 0.779);     // 푸른 헤이즈 hsl(215°, 42%, 62%)
  vec3 teal2 = vec3(0.27, 0.39, 0.62);
  float nearCore = exp(-pow((s - uCore) / 0.28, 2.0));
  vec3 bodyCol = mix(cream, coolW, smoothstep(0.38, 0.95, s));
  bodyCol = mix(bodyCol, amber1, 0.5 * nearCore * (1.0 - 0.5 * cloud));
  bodyCol = mix(bodyCol, apricot, 0.35 * nearCore * smoothstep(0.5, 0.05, coreE));
  vec3 coreCol = mix(amber2, amber1, smoothstep(0.15, 0.85, coreE));
  coreCol = mix(coreCol, cream, smoothstep(0.75, 1.2, coreE) * 0.3);
  coreCol = mix(coreCol, apricot, 0.45 * smoothstep(0.6, 0.15, coreE) * smoothstep(0.02, 0.2, coreE));
  float coreC = 1.0 + 0.06 * uStill;

  vec3 light = bodyCol * dens * 0.22;
  light += mix(bodyCol, cream, 0.5) * cloud * body * prof * 0.1;
  light += coreCol * pow(max(coreE, 0.0), coreC) * 0.8;
  light += mix(teal1, teal2, smoothstep(0.0, 2.6, abs(t))) * haze * 0.27 * mix(1.0, prof, 0.6);
  // 미세한 별: 세 스케일, 띠 밀도에 비례 (먼지 뒤에서는 가려진다)
  float d2 = clamp(dens + 0.9 * coreE, 0.0, 1.6);
  // 미세한 별(별 그레인)은 매 프레임 PRESENT가 월드 좌표에서 그린다 — 줌해도 커지지 않고 더 많이 풀려 나온다
  light *= endF;

  // 작은 방출 성운 (H-α 분홍 · 반사 청), 드물게
  vec2 np = p * 8.5 + sd * 2.0;
  float hk = smoothstep(0.62, 0.86, fbm(np)) * smoothstep(0.55, 1.5, abs(t)) * exp(-0.5 * t * t / 4.0) * endF * smoothstep(0.05, 0.25, s) * (1.0 - smoothstep(0.7, 0.95, s));
  float hpick = fbm(np * 0.35 + vec2(11.0, 4.0));
  vec3 neb = (hpick < 0.05 ? vec3(0.95, 0.36, 0.56) : vec3(0.42, 0.62, 0.95)) * hk * 0.15 * uNebula;
  vec2 wp = p * 1.1 + sd;
  neb += vec3(0.22, 0.3, 0.5) * smoothstep(0.1, 0.8, fbm(wp + 1.3 * vec2(fbm(wp * 0.8 + 1.0), fbm(wp * 0.8 + 5.0)))) * 0.015 * uNebula;

  // 먼지띠: 축을 따라 길게 뻗고 갈라지는 실 (리지드 멀티프랙탈 + 도메인 왜곡, 가장자리 또렷)
  vec2 dq = vec2(s * len / w0 * 0.3, t) + sd * 0.7;
  dq += 0.32 * vec2(fbm(dq * 1.8 + 1.7), fbm(dq * 1.8 + 9.1));
  float rm = ridgedMF(dq * vec2(1.0, 2.1));
  // 가는 먼지 실은 띠 안쪽, 일부 구역에만 (큰 스케일 마스크)
  float laneMask = smoothstep(0.0, 0.45, fbm(dq * 0.55 + vec2(2.0, 8.0)));
  float lanes = smoothstep(0.6, 0.82, rm) * exp(-0.5 * t * t / 0.6) * laneMask;
  float base = -0.12 + 0.2 * fbm(vec2(s * 3.0, 2.0) + sd);
  float split = max(s - 0.42, 0.0);
  float rw = (0.1 + 0.2 * (0.5 + 0.5 * fbm(vec2(s * 5.0, 5.0) + sd))) * 1.7;
  float jag = 0.45 * fbm(dq * 4.5);
  // 가장자리는 부드럽게, 불규칙하게 끊기고 뭉친 조각으로
  float r1 = 1.0 - smoothstep(0.25, 1.25, abs((t - (base - 0.9 * split)) / rw) + jag);
  float r2 = (1.0 - smoothstep(0.25, 1.25, abs((t - (base + 0.8 * split)) / (rw * 0.75)) + jag)) * smoothstep(0.42, 0.52, s);
  float patchy = smoothstep(-0.25, 0.2, fbm(dq * vec2(1.3, 1.9) * 1.6 + 4.0)) * (0.6 + 0.4 * smoothstep(-0.25, 0.3, fbm(dq * 5.0 + 2.0)));
  float rift = max(r1, r2) * patchy * smoothstep(0.06, 0.16, s);
  float D = clamp(max(rift, lanes * 0.8) * uDust * endF, 0.0, 1.0);
  vec3 dustMul = mix(vec3(1.0), vec3(0.3, 0.19, 0.13), 0.58 * D);   // 최대 58%, 갈색 먼지
  float rim = clamp(D * (1.0 - D) * 4.0, 0.0, 1.0);

  vec3 S = texture(uStars, tuv).rgb;
  vec3 S3 = texture(uStars3, tuv).rgb;
  vec3 Bl = texture(uBlur, tuv).rgb;
  vec3 Bl3 = texture(uBlur3, tuv).rgb;
  float bk = 1.2 * (0.25 + body);
  vec3 star4 = S + Bl * bk;
  vec3 star3 = S3 + Bl3 * bk;

  vec3 band = (light + neb) * dustMul;
  // 코어 둘레 부드러운 블룸
  band += mix(amber2, amber1, 0.5) * coreWide * 0.055 * endF;
  // 빛 받은 먼지의 적갈색 가장자리
  band += vec3(0.5, 0.27, 0.16) * rim * body * prof * 0.05 * endF;
  o0 = vec4(encL(max(band, 0.0)), D);
  vec3 stars = star4 + star3;
  // L1 (RGBA8): 별빛 sqrt 인코딩 · a = 미세 별 밀도
  o1 = vec4(sqrt(clamp(stars / 4.0, 0.0, 1.0)), clamp(d2 * endF / 1.6, 0.0, 1.0));
}
`

/* ---------- 매 프레임: 정적 하늘 표시 (노출 크로스페이드) ---------- */
export const PRESENT_FS = /* glsl */ `#version 300 es
precision highp float;
${BAND}
${NOISE}
in vec2 vUv;
uniform sampler2D uL0;
uniform sampler2D uL1;
uniform sampler2D uP0;     // 이전 해상도의 층 (크기 바뀐 뒤 이어 받기)
uniform sampler2D uP1;
uniform float uLayerMix;   // 1 = 새 층만
uniform vec4 uSafeB[3];    // 다음 장면의 안전 구역
uniform float uMix;        // 장면 크로스페이드 0..1 (안전 구역)
uniform float uBright;
uniform float uStarExpo;
uniform float uFaint;
uniform float uBlue;
uniform float uAirglow;
uniform float uGain;       // 겹친 창(⌘K) 감광 등
uniform vec3 uTint;        // 장면 색조 (곱하기, 1 = 없음)
uniform float uBakeK;      // 굽기 틀 = 화면의 1/uBakeK 배 넓이
uniform sampler2D uTile;   // 장소 고해상도 타일 (띠 빛 · 먼지)
uniform vec4 uTileRect;    // 월드 uv x0, y0, x1, y1
uniform float uTileW;      // 0 = 안 씀
out vec4 o;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
/* 미세 별: 월드 css px 격자, 별 크기는 화면 px로 고정(줌해도 커지지 않음) */
float mstar(vec2 px, float cell, float prob, float maxB, float z) {
  vec2 g = floor(px / cell);
  vec2 f = px / cell - g;
  if (hash12(g + 0.37 + cell) > prob) return 0.0;
  vec2 pos = 0.2 + 0.6 * vec2(hash12(g + 13.1), hash12(g + 71.7));
  vec2 d = (f - pos) * cell * z;
  float b = pow(hash12(g + 5.3), 3.5) * maxB;
  return b * exp(-dot(d, d) / (2.0 * 0.4 * 0.4));
}
void main() {
  vec2 uv = vUv;                                   // 화면 uv (안전 구역·바탕·비네트)
  vec2 wuv = worldUV(uv);                          // 월드 uv (하늘)
  vec2 bk = (wuv - 0.5) * uBakeK + 0.5;
  vec2 tuv = vec2(bk.x, 1.0 - bk.y);
  float zc = uCam.z;
  vec4 a = texture(uL0, tuv);
  vec4 b = texture(uL1, tuv);
  if (uLayerMix < 0.999) {
    vec4 pa = texture(uP0, tuv);
    vec4 pb = texture(uP1, tuv);
    a = vec4(mix(decL(pa.rgb), decL(a.rgb), uLayerMix), mix(pa.a, a.a, uLayerMix));
    b = mix(pb, b, uLayerMix);
  } else {
    a.rgb = decL(a.rgb);
  }
  b.rgb = b.rgb * b.rgb * 4.0;
  // 가까이 갈 장소는 유휴 시간에 미리 구운 고해상도 타일로 (가장자리는 6%에 걸쳐 섞는다 — 이음매 없음)
  if (uTileW > 0.0) {
    vec2 q = (wuv - uTileRect.xy) / (uTileRect.zw - uTileRect.xy);
    if (q.x > 0.0 && q.y > 0.0 && q.x < 1.0 && q.y < 1.0) {
      vec4 tt = texture(uTile, vec2(q.x, 1.0 - q.y));
      vec2 e2 = smoothstep(vec2(0.0), vec2(0.06), q) * smoothstep(vec2(1.0), vec2(0.94), q);
      float w = uTileW * e2.x * e2.y;
      a = vec4(mix(a.rgb, decL(tt.rgb), w), mix(a.a, tt.a, w));
    }
  }
  float D = a.a;
  vec3 dustMul = mix(vec3(1.0), vec3(0.3, 0.19, 0.13), 0.58 * D);
  // 가까이 가면 먼지띠 가장자리가 더 섬세하게 (매 프레임 디테일, 굽기 없음)
  float zd = smoothstep(1.05, 2.2, zc);
  if (zd > 0.0) {
    vec2 wp = vec2(wuv.x * uAspect, wuv.y);
    float n = snoise(wp * 46.0) * 0.6 + snoise(wp * 103.0) * 0.4;
    float D2 = clamp(D * (1.0 + 0.45 * zd * n) + 0.08 * zd * n * smoothstep(0.05, 0.4, D), 0.0, 1.0);
    vec3 dm2 = mix(vec3(1.0), vec3(0.3, 0.19, 0.13), 0.58 * D2);
    a.rgb *= dm2 / dustMul;
    dustMul = dm2;
    D = D2;
  }
  // 희미한 별: 줌하면 구운 별은 물러나고(커지지 않게) 미세 별이 더 많이 풀려 나온다
  vec3 starLight = b.rgb * mix(1.0, uFaint, 0.6) * uStarExpo * (1.0 - 0.75 * smoothstep(1.0, 1.8, zc));
  float d2 = b.a * 1.6;
  // 희미한 별도 깊이 층에: 옥타브마다 δ가 달라 비행 중에만 아주 조금 다르게 다가온다 (정지하면 같다)
  #define WPX(dl) (((uv - 0.5) / (zc * (1.0 + (dl) * uCam.w)) + uCam.xy) * uView)
  float ms = mstar(WPX(0.08), 6.8, 0.36 * d2 + 0.012, 0.7, zc) + mstar(WPX(0.06), 3.4, 0.6 * d2, 0.36, zc)
           + mstar(WPX(0.04), 2.1, 0.85 * d2, 0.2, zc) + mstar(WPX(0.02), 1.5, 0.9 * d2, 0.1, zc);
  float r1 = smoothstep(1.4, 2.4, 1.05 * zc);
  float r2 = smoothstep(1.4, 2.4, 0.74 * zc);
  float r3 = smoothstep(1.4, 2.4, 0.52 * zc);
  vec2 wpx = wuv * uView;
  if (r1 > 0.0) ms += mstar(WPX(0.01), 1.05, 0.9 * d2, 0.14, zc) * r1;
  if (r2 > 0.0) ms += mstar(wpx, 0.74, 0.9 * d2, 0.12, zc) * r2;
  if (r3 > 0.0) ms += mstar(wpx, 0.52, 0.9 * d2, 0.11, zc) * r3;
  float la = max(dot(a.rgb, vec3(0.299, 0.587, 0.114)), 1e-4);
  vec3 msCol = mix(vec3(1.0, 0.962, 0.9), clamp(a.rgb / la * 0.75, 0.0, 1.4), 0.5);
  // 풀려 나온 별빛만큼 매끈한 빛은 조금 줄인다
  float smoothK = 1.0 - 0.14 * smoothstep(1.0, 3.0, zc);
  vec3 lightAll = (a.rgb * smoothK + msCol * ms * dustMul) * uBright * uTint + starLight * mix(vec3(1.0), dustMul, 0.85);
  // 채도 +35% (네온 금지: 밝은 곳은 덜)
  float lum = dot(lightAll, vec3(0.299, 0.587, 0.114));
  lightAll = max(mix(vec3(lum), lightAll, 1.65 - 0.2 * smoothstep(0.5, 1.4, lum)), 0.0);
  // 톤: 휘도로 압축해 색상·채도를 지킨다 (밝은 코어가 회색으로 바래지 않게)
  float lumA = dot(lightAll, vec3(0.299, 0.587, 0.114));
  vec3 Lh = min(lightAll * (1.0 - exp(-lumA * 1.3)) / max(lumA, 1e-4), vec3(1.0));
  vec3 L = mix(Lh, 1.0 - exp(-lightAll * 1.3), 0.25);
  // 색보정: 어두운 곳은 차가운 남색, 밝은 곳은 따뜻한 금색 (네온 금지, 곱하기로 살짝)
  float lumL = dot(L, vec3(0.299, 0.587, 0.114));
  L *= mix(vec3(0.88, 0.95, 1.12), vec3(1.06, 1.0, 0.86), smoothstep(0.04, 0.5, lumL));

  // 바탕: 깊은 남흑색 + 옅은 그라디언트, 아래 대기광
  vec3 top = mix(vec3(0.018, 0.027, 0.058), vec3(0.047, 0.082, 0.188), uBlue);
  vec3 bot = mix(vec3(0.036, 0.052, 0.1), vec3(0.075, 0.115, 0.2), uBlue);
  vec3 sky = mix(top, bot, smoothstep(0.0, 1.0, uv.y));
  sky = mix(sky, vec3(0.055, 0.102, 0.11), 0.4 * uAirglow * smoothstep(0.8, 1.0, uv.y));

  // 글자 안전 구역: 하늘 밝기 #161C2C 이하 (사진의 버닝처럼)
  float m = mix(safeMask(uv, 130.0), safeMaskR(uv, 130.0, uSafeB), uMix) * 0.94;
  vec3 safeMax = vec3(0.086, 0.11, 0.173);
  vec3 room = max(safeMax - sky, vec3(0.004));
  vec3 Ls = room * (1.0 - exp(-L / room));
  L = mix(L, Ls, m);

  vec3 c = sky + L;
  vec2 vq = (uv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0);
  c *= 1.0 - 0.3 * pow(clamp(length(vq) * 1.25, 0.0, 1.0), 2.2);
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(max(c * uGain, 0.0), 1.0);
}
`
/* 낮(건판): 밤 프레임 전체를 음화로 — 종이빛 유리 위 먹색 별, 암흑대는 밝은 틈 */
export const PLATE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA;
uniform float uPlate;   // 0 = 밤 그대로, 1 = 건판
out vec4 o;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = texture(uA, uv).rgb;
  float lum = max(dot(c, vec3(0.3, 0.55, 0.15)) - 0.05, 0.0);
  vec3 paper = mix(vec3(0.957, 0.937, 0.902), vec3(0.925, 0.9, 0.86), smoothstep(0.78, 1.0, vUv.y)); // 따뜻한 종이
  vec3 inkBand = vec3(0.47, 0.41, 0.34);      // 회갈 결
  vec3 inkStar = vec3(0.09, 0.1, 0.13);       // 먹점
  // 밝아진 코어가 별 먹점으로 오인되지 않게 별 문턱을 올린다
  float starK = smoothstep(0.74, 0.95, lum);
  vec3 ink = mix(inkBand, inkStar, starK);
  float k = mix(pow(clamp(lum * 1.1, 0.0, 1.0), 1.2) * 0.7, 0.95, starK);
  o = vec4(mix(c, mix(paper, ink, k), uPlate), 1.0);
}
`

/* ---------- 매 프레임: 0~2등급 별 · 데이터 별 ---------- */
export const STAR_DYN_VS = /* glsl */ `#version 300 es
precision highp float;
${BAND}
uniform float uRes;
uniform float uTime;
uniform float uAnimTime; // 사건 시계(데이터 별 보간·누름) — 주변 시계 uTime과 분리(전력 쉼)
uniform float uMotion;   // 0 = 정지 장면
uniform vec4 uPointer;   // css px x, y, 반경, 세기(0..1, 켜짐 250ms · 꺼짐 900ms)
uniform vec4 uTaps[4];   // css px x, y, t0, 세기
uniform sampler2D uStatic;
uniform float uAlpha;
uniform float uFocus;
uniform float uStarExpo;
uniform float uDynCut;
uniform float uSpikes;   // 1 = 피어남 회절 허용 (데이터 별 층에서만)
uniform float uBakeK;
in float aKind;
in vec2 aPos;
in float aL;
in vec3 aCol;
in float aPhase;
in vec4 aAnim;           // 데이터 별: 밝기 from, to, t0, dur(초)
out vec3 vCol;
out float vSig;
out float vGlow;
out float vGlowS;
out float vPx;
out float vSpike;
out float vSpikeL;
void main() {
  vec2 p;
  float L = aL;
  float special = 0.0;
  if (aKind < 0.5) p = bandToWorld(aPos.x, aPos.y);
  else p = vec2(aPos.x * uAspect, aPos.y);
  vec2 uv = vec2(p.x / uAspect, p.y);
  float burst = 0.0;     // 1 = V1 피어남, 2 = V1s 작은 피어남
  float age = 1e3;
  if (aKind > 1.5) {
    special = 1.0;
    float kind = floor(aKind + 0.01);
    float fr = aKind - kind;
    burst = fr > 0.4 ? 2.0 : (fr > 0.1 ? 1.0 : 0.0);
    age = uAnimTime - aAnim.z;
    if (kind < 3.0) {
      // 밝기 보간 (V3 다시 켜짐 · V4 꺼져 감 · 성장): 단조, 넘침 없음
      float k = smoothstep(0.0, 1.0, clamp(age / max(aAnim.w, 0.001), 0.0, 1.0));
      L *= mix(aAnim.x, aAnim.y, k);
      // V1 오름 400ms (out)
      if (burst > 0.5) L *= 1.0 - pow(1.0 - clamp(age / (burst > 1.5 ? 0.8 : 0.4), 0.0, 1.0), 3.0);
    } else L *= max(uFocus, 0.02);                                              // 집중: 밝기 = 진행률
  } else if (L < uDynCut) L = 0.0;
  // 반짝임: 1~2등급의 8%만 ±12%, 0등급은 ±6%. 주기 3–9초. 크기 변화 0
  float ph = special > 0.5 ? 1.7 : aPhase;
  float f = 6.2831853 / (3.0 + 6.0 * fract(ph * 7.31 + aL * 0.013));
  float amp = special > 0.5 ? 0.0 : (aL >= 143.0 ? 0.06 : (fract(ph * 9.13) < 0.08 ? 0.12 : 0.0));
  float tw = 1.0 + uMotion * amp * sin(uTime * f + ph * 3.0);
  // 포인터·펜 근처: 밝기만 최대 +35% (위치 이동 0)
  vec2 px = camUV(uv, 1.0) * uView;
  float pb = 1.0 + 0.35 * uPointer.w * (1.0 - smoothstep(uPointer.z * 0.25, uPointer.z, length(px - uPointer.xy)));
  float tb = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 tp = uTaps[i];
    float age = uAnimTime - tp.z;
    if (tp.w > 0.0 && age >= 0.0 && age < 1.8) {
      float env = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.35, 1.8, age));
      tb += env * tp.w * (1.0 - smoothstep(16.0, 110.0, length(px - tp.xy)));
    }
  }
  // 깊이 층 5개: 층별 배율 = 카메라 배율 × (1 + δ·sin(π·진행률)), δ 0~0.08 — 정지하면 모든 층이 같다
  float layer = floor(fract(aPhase * 13.7 + aL * 0.031) * 5.0);   // δ = 0, .02, .04, .06, .08
  float zm = 1.0 + uCam.w * layer * 0.02;
  vec2 bk = (uv - 0.5) * uBakeK + 0.5;
  vec2 suv = camUV(uv, zm);
  float T = (1.0 - 0.88 * texture(uStatic, vec2(bk.x, 1.0 - bk.y)).a) * (1.0 - 0.94 * safeMask(suv, 130.0));
  if (special > 0.5) T = 1.0;
  float b = L * tw * pb * (1.0 + 0.6 * tb) * mix(1.0, T, 0.95) * (special > 0.5 ? 1.0 : uStarExpo);
  // 2등급 0.8–1.2px 35–65% · 1등급 1.2–1.8px 70–90% (할로 4–6px 15%) · 0등급 2.0–2.8px 100% (할로 10–18px 30%)
  float g = clamp(log2(max(b, 0.001) / 5.0) / log2(143.0 / 5.0), 0.0, 1.0);
  float dia = mix(0.8, 2.2, g) + 0.6 * smoothstep(143.0, 600.0, b);
  float peak = mix(0.35, 1.0, g) * smoothstep(0.0, 5.0, b);
  vSig = max(dia / 2.355 * uRes, 0.5);
  vGlow = b >= 143.0 ? 0.3 : (b >= 24.0 ? 0.15 * smoothstep(24.0, 40.0, b) : 0.0);
  vGlowS = (b >= 143.0 ? mix(4.5, 7.0, smoothstep(143.0, 600.0, b)) : 2.0) * uRes;
  // 회절 스파이크는 별이 태어나는 순간에만 (V1: 팔 0 → 11px → 4px, 1.2초, 불투명도 ≤ 45%)
  vSpike = 0.0;
  vSpikeL = 1.0;
  if (burst > 0.5 && age >= 0.0 && age < 1.6) {
    float up = 1.0 - pow(1.0 - clamp(age / 0.4, 0.0, 1.0), 3.0);
    float settle = smoothstep(0.4, 1.2, age);
    if (burst < 1.5) {
      vGlow = max(vGlow, 0.32 * up * mix(1.0, 0.45, settle));
      vGlowS = mix(14.0, 9.0, settle) / 2.355 * up * uRes + 0.5;
      vSpike = uSpikes * 1.6 * up * (1.0 - smoothstep(1.2, 1.6, age));
      vSpikeL = mix(11.0, 4.0, settle) / 3.0 * uRes;
    } else {
      vGlow = max(vGlow, 0.25 * up * mix(1.0, 0.5, smoothstep(0.4, 0.8, age)));
      vGlowS = 6.0 / 2.355 * up * uRes + 0.5;
    }
  }
  vPx = min(burst > 0.5 ? 40.0 * uRes : 140.0, max(vSig * 7.0, max(vGlow > 0.0 ? vGlowS * 6.0 : 0.0, vSpike > 0.0 ? 34.0 * uRes : 0.0)));
  vCol = aCol * peak * uAlpha;
  gl_Position = worldToClipZ(p, zm);
  gl_PointSize = b > 0.0 ? vPx : 0.0;
}
`
export const STAR_DYN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vCol;
in float vSig;
in float vGlow;
in float vGlowS;
in float vPx;
in float vSpike;
in float vSpikeL;
out vec4 o;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vPx;
  float r2 = dot(d, d);
  float core = exp(-r2 / (2.0 * vSig * vSig));
  float glow = vGlow * exp(-r2 / (2.0 * vGlowS * vGlowS));
  float sp = 0.0;
  if (vSpike > 0.0) {
    // 회절: 가늘고 끝으로 갈수록 가늘어지며 사라지는 4갈래 (가로 폭은 가우시안, 길이는 지수 감쇠)
    float l = vSpikeL;
    float wx = max(vSig * 0.42, 0.32) * (1.0 + abs(d.x) / (l * 6.0));
    float wy = max(vSig * 0.42, 0.32) * (1.0 + abs(d.y) / (l * 6.0));
    float ax = exp(-0.5 * d.y * d.y / (wx * wx)) * exp(-abs(d.x) / l);
    float ay = exp(-0.5 * d.x * d.x / (wy * wy)) * exp(-abs(d.y) / l);
    sp = (ax + ay) * 0.34 * vSpike;
  }
  float e = 1.0 - smoothstep(0.42, 0.5, length(gl_PointCoord - 0.5));
  o = vec4(vCol * (core + glow + sp) * e, 0.0);
}
`

/* ---------- 매 프레임: 별가루 낙하 (띠의 아래쪽 가장자리에서 수직 아래로) ---------- */
export const DUST_VS = /* glsl */ `#version 300 es
precision highp float;
${BAND}
uniform float uRes;
uniform float uTime;
uniform float uAlpha;
uniform float uFall;
uniform vec4 uGather;   // V7 별가루 모임: 화면 px x, y, 세기 0..1 (4초 보간), 반경 px
in vec4 aA;  // s, t, speed(px/s), life(s)
in vec4 aB;  // phase, size(px), bright, 각도(rad, ±6°)
out float vA;
out float vSig;
out float vPx;
out vec3 vCol;
void main() {
  float life = aA.w;
  float tt = uTime + aB.x * life;
  float age = mod(tt, life);
  float cyc = floor(tt / life);
  float j = fract(sin(cyc * 12.9898 + aB.x * 78.233) * 43758.5453);
  float s = clamp(aA.x + (j - 0.5) * 0.12, 0.22, 0.7);
  vec2 p0 = bandToWorld(s, aA.y + (fract(j * 7.13) - 0.5) * 0.4);
  vec2 px = camUV(vec2(p0.x / uAspect, p0.y), 1.0) * uView;
  float ang = aB.w;
  // V7: 30%만, 반경 안에서, 낙하 방향을 그 자리 쪽으로 튼다 (수직에서 25° 이하, 속도 그대로)
  if (uGather.z > 0.0 && fract(aB.x * 3.31) < 0.3) {
    vec2 v = uGather.xy - px;
    float near = 1.0 - smoothstep(uGather.w * 0.6, uGather.w, length(v));
    float at = clamp(atan(v.x, max(v.y, 1.0)), -0.436, 0.436);
    ang = mix(ang, at, uGather.z * near);
  }
  px += vec2(sin(ang), cos(ang)) * aA.z * age;   // 수직 아래 ±6° (모임 ≤ 25°), 가속 없음
  vec2 uv = px / uView;
  float env = smoothstep(0.0, 2.0, age) * (1.0 - smoothstep(life - 4.0, life, age));
  float sm = safeMask(uv, 24.0);   // 글자 안전 구역 24px 앞에서 투명해진다
  float on = fract(aB.x * 7.77) < uFall ? 1.0 : 0.0;
  vA = aB.z * env * (1.0 - sm) * on * uAlpha;
  vCol = mix(vec3(1.0, 0.914, 0.78), vec3(0.863, 0.894, 1.0), smoothstep(0.25, 0.7, s)); // #FFE9C7 → #DCE4FF
  vSig = max(aB.y / 2.355 * uRes, 0.5);
  vPx = ceil(14.0 * uRes);
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  gl_PointSize = vA > 0.001 ? vPx : 0.0;
}
`
export const DUST_FS = /* glsl */ `#version 300 es
precision highp float;
in float vA;
in float vSig;
in float vPx;
in vec3 vCol;
uniform float uRes;
out vec4 o;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vPx;
  float g = exp(-dot(d, d) / (2.0 * vSig * vSig));
  // 꼬리: 0.6초 동안 움직인 거리(약 5px) 위쪽으로, 20%
  float tl = 5.0 * uRes;
  float tail = (d.y < 0.0 && d.y > -tl) ? 0.2 * exp(-d.x * d.x / (2.0 * vSig * vSig)) * (1.0 + d.y / tl) : 0.0;
  o = vec4(vCol * (g + tail) * vA, 0.0);
}
`

/* ---------- 유성 (평균 3분에 1회, 짧고 가늘게) ---------- */
export const METEOR_VS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uView;
uniform vec4 uMet;     // 시작 css px x, y, 방향 x, y
uniform vec2 uMetP;    // 진행 0..1, 길이 px
out float vAlong;
out float vSide;
void main() {
  float along = float(gl_VertexID >> 1);
  float side = float(gl_VertexID & 1) * 2.0 - 1.0;
  vec2 dir = uMet.zw;
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 head = uMet.xy + dir * uMetP.y * 1.6 * uMetP.x;
  vec2 px = head - dir * uMetP.y * (1.0 - along) + nrm * side * 1.0;
  vAlong = along;
  vSide = side;
  vec2 uv = px / uView;
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}
`
export const METEOR_FS = /* glsl */ `#version 300 es
precision highp float;
in float vAlong;
in float vSide;
uniform float uMetA;
out vec4 o;
void main() {
  float a = pow(vAlong, 2.2) * (1.0 - abs(vSide)) * uMetA;
  vec3 c = mix(vec3(0.6, 0.72, 1.0), vec3(1.0, 0.97, 0.92), vAlong);
  o = vec4(c * a, 0.0);
}
`
