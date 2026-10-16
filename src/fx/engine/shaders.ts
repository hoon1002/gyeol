/**
 * 결 필드 셰이더 (WebGL2 / GLSL ES 3.00).
 *
 * 노이즈 값 v(x, y, t)의 등치선(iso-line)을 그린다.
 *   u = (v + 3) / step − phase  →  정수 u 자리마다 1px 선(fract + fwidth 안티에일리어싱),
 *   u/4가 정수인 자리(4번째마다)는 굵은 계곡선.
 * 옹이(가우시안 봉우리) · 물결(퍼지는 고리) · 인주 번짐 · 데이터 고리는 모두 유니폼이다.
 * 좌표는 CSS px(왼쪽 위 원점, y 아래로)로 맞춰 JS 쪽 값과 1:1.
 */

export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uView;        // CSS px 화면 크기
uniform vec2 uPx;          // 캔버스 내부 px 크기
uniform float uRes;        // 내부 px / CSS px
uniform float uTime;       // 노이즈 z (흐름)
uniform float uNow;        // 초 (물결 나이 계산)
uniform float uStep;
uniform vec2 uAniso;
uniform float uScale;
uniform float uAmp;        // 숨 (0.92..1)
uniform int uOctaves;
uniform vec4 uKnot[4];     // xy = CSS px, z = 세기
uniform float uKnotR;
uniform vec4 uRipple[4];   // xy, t0(초), amp
uniform vec4 uRippleAcc;   // 물결별 인주색 여부 0/1
uniform float uPhase;      // 결 와이프 위상
uniform float uGlow;       // 와이프 중 선 밝기 가산
uniform vec4 uTint;        // rgb, 세기
uniform vec4 uRings;       // 개수(소수 = 그려지는 중), 축척, 투명도, -
uniform vec4 uSeal;        // xy, 세기(0..1), 퍼짐(0..1)
uniform float uSealBump;   // 1 = 등고선을 한 겹 밀어냄, 0 = 색만(절제)
uniform float uDim;
uniform vec4 uMinor;       // 비-프리멀티플라이 rgba
uniform vec4 uMajor;
uniform vec3 uAccent;

out vec4 outColor;

// 3D simplex noise — Ian McEwan, Ashima Arts / Stefan Gustavson (MIT License)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// 폭 w(px) 선의 덮임. w < 1이면 1px로 그리고 투명도로 줄인다(가는 선 계단 방지)
float lineA(float d, float w) {
  float ww = max(w, 1.0);
  return clamp(ww * 0.5 + 0.5 - d, 0.0, 1.0) * min(w, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uPx.y - gl_FragCoord.y) * (uView / uPx);
  float R = uKnotR;
  float R2 = R * R;

  // 1) 노이즈 결
  vec2 q = p * uScale * uAniso;
  float v = snoise(vec3(q, uTime));
  if (uOctaves > 1) {
    v += 0.42 * snoise(vec3(q * vec2(2.7, 2.0) + vec2(31.0, 7.0), uTime * 1.35 + 4.0));
  }
  v *= uAmp;

  // 2) 옹이 (최대 4)
  float tw = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 k = uKnot[i];
    if (k.z > 0.001) {
      vec2 d = p - k.xy;
      float d2 = dot(d, d);
      v += k.z * 1.35 * exp(-d2 / R2);
      tw = max(tw, min(k.z, 1.0) * exp(-d2 / (R2 * 1.15)));
    }
  }

  // 3) 물결 (최대 4) — 퍼짐 520px/s, 지수 감쇠, 2.6s 수명
  float racc = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipple[i];
    float age = uNow - r.z;
    if (r.w > 0.0 && age >= 0.0 && age < 2.6) {
      float dd = distance(p, r.xy);
      float w = (dd - age * 520.0) / 64.0;
      float env = r.w * exp(-age * 1.5) * exp(-w * w) * (1.0 - smoothstep(2.0, 2.6, age));
      v += env * cos(w * 2.4) * 0.55;
      racc = max(racc, uRippleAcc[i] * env);
    }
  }

  // 4) 인주 번짐 — 옹이 둘레가 물들며 한 겹 바깥으로
  float sw = 0.0;
  if (uSeal.z > 0.001) {
    vec2 sd = p - uSeal.xy;
    float sR = R * (0.75 + 0.95 * uSeal.w);
    sw = uSeal.z * exp(-dot(sd, sd) / (sR * sR));
    v += sw * uStep * 1.35 * uSealBump;
  }

  // 5) 등치선
  float u = (v + 3.0) / uStep - uPhase;
  float fw = max(fwidth(u), 1e-5);
  float dMin = abs(fract(u - 0.5) - 0.5) / fw;
  float u4 = u * 0.25;
  float fw4 = fw * 0.25;
  float dMaj = abs(fract(u4 - 0.5) - 0.5) / fw4;
  // 선이 3px보다 촘촘해지는 곳(옹이 꼭대기)은 흐리게 → 무아레 방지
  float aMin = lineA(dMin, 0.9 * uRes) * (1.0 - smoothstep(0.28, 0.62, fw));
  float aMaj = lineA(dMaj, 1.3 * uRes) * (1.0 - smoothstep(0.32, 0.7, fw4));

  vec3 tint = uTint.rgb;
  float tA = tw * uTint.a;
  vec4 cMin = mix(uMinor, vec4(tint, 0.62), tA);
  vec4 cMaj = mix(uMajor, vec4(tint, 0.86), tA * 0.75);
  if (sw > 0.001) {
    float s = min(sw * 1.25, 1.0);
    cMin = mix(cMin, vec4(uAccent, 0.9), s);
    cMaj = mix(cMaj, vec4(uAccent, 1.0), s);
  }
  if (racc > 0.001) {
    float ra = min(racc, 1.0);
    cMin = mix(cMin, vec4(uAccent, 0.75), ra);
    cMaj = mix(cMaj, vec4(uAccent, 0.95), ra);
  }
  float boost = 1.0 + uGlow;
  float am = aMin * (1.0 - aMaj) * min(cMin.a * boost, 1.0);
  float aj = aMaj * min(cMaj.a * boost, 1.0);
  vec3 rgb = cMin.rgb * am + cMaj.rgb * aj;
  float a = am + aj;

  // 6) 데이터 고리 — 오늘 집중 세트 수. 소수 부분은 12시 방향부터 시계 방향으로 그려지는 중
  float n = uRings.x;
  if (n > 0.001) {
    vec2 c0 = uKnot[0].xy;
    float sc = uRings.y;
    float maxR = (16.0 + 13.0 * ceil(n)) * sc * 1.12 + 26.0;
    vec2 dc = p - c0;
    if (dot(dc, dc) < maxR * maxR) {
      float ringA = 0.0;
      for (int r = 0; r < 14; r++) {
        float fr = float(r);
        if (fr >= n) break;
        float part = clamp(n - fr, 0.0, 1.0);
        vec2 d = p - (c0 + vec2(fr * 1.6, -fr * 0.8) * sc);
        float ang = atan(d.y, d.x);
        float wob = sin(ang * 2.0 + fr * 1.3 + uTime * 6.0) * 0.5
                  + sin(ang * 3.0 - fr * 0.7 - uTime * 4.0) * 0.33
                  + sin(ang * 5.0 + fr * 2.1 + uTime * 9.0) * 0.17;
        float rr = (16.0 + fr * 13.0) * sc * (1.0 + 0.07 * wob);
        float dist = abs(length(d) - rr) * uRes;
        float ra = lineA(dist, 1.4 * uRes) * max(0.22, 0.8 - fr * 0.07);
        if (part < 0.999) {
          float t01 = fract((ang + 1.5707963) / 6.2831853 + 1.0);
          ra *= 1.0 - smoothstep(part - 0.012, part, t01);
          // 그려지는 끝 — 붓끝처럼 조금 밝게
          ra *= 1.0 + 0.6 * smoothstep(part - 0.06, part, t01);
        }
        ringA = max(ringA, ra);
      }
      ringA = min(ringA * uRings.z, 1.0);
      rgb = rgb * (1.0 - ringA) + uAccent * ringA;
      a = a * (1.0 - ringA) + ringA;
    }
  }

  // 7) 인주 번짐의 옅은 물듦 (면적 작게)
  float wash = sw * 0.075;
  rgb += uAccent * wash * (1.0 - a);
  a += wash * (1.0 - a);

  outColor = vec4(rgb, a) * uDim;
}
`
