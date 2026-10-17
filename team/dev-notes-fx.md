# 개발 노트 — 결 모션 엔진 (fx)

## 전력 상태 · 프레임 스케줄러 (성능 엔지니어, 2026-10-17 · 리더 위임으로 fx·galaxy 수정)

자세한 내용은 `team/power-budget.md` §7에 있다. 공개 API와 시각 결과는 그대로다.

**바뀐 동작**
- `Sky` 루프는 프레임마다 전력 상태를 정한다(`src/perf/scheduler.ts`).
  - busy(전환·비행·굽기·사건·유성·누름·별가루 모임·데이터 별 피어남) = 기기 주사율
  - 입력 2초 = 60, 평소 30, 깊은 대기 15
  - 쉼 = 예약 없음. `kick()`이 부르면 한 장 그린다.
- fps 상한은 `setTimeout → rAF`로 '다음 프레임 직전에만' 깨운다. rAF에서 건너뛰지 않으므로 깨우기 수 = 그린 프레임 수다.
- 셰이더 `STAR_DYN_VS`: 데이터 별 보간·누름의 나이는 `uAnimTime`(= `now()`, 사건 시계), 반짝임은 `uTime`(= 주변 시계 `AmbientClock`)을 쓴다.
  - 주변 시계는 쉼에 들어가면 2초에 걸쳐 멈추고, 깨어나면 600ms에 걸쳐 다시 흐른다.
  - 둘을 나눈 이유: 쉬는 동안 하늘은 멈춰 있어도 집중 별 자람(`growStar`)은 맞게 그려져야 한다.
- `setSpecial`: 밝기 차 ≥ 0.05·피어남·birth·relight는 끝날 때까지 busy, 작은 보간은 끝에 한 장(`wantAt`).
- 깊은 대기·쉼에서는 환경 유성을 미룬다(신호 유성은 그대로).
- 등급 자동 판정 표본은 매 vsync를 요청한 프레임만 쓴다.
- 깨운 첫 프레임의 간격은 0이다(`navs()` 오염 방지).
- `pointer()`: 루프가 돌고 있으면 vsync로 당기지 않는다.
- 새 API(추가만):
  - `Sky.setPowerRule(rule | null)`: field가 프리셋마다 `SPACE_RULES`(집중 20초 → 쉼, 노트·복습·설정 30초 → 깊은 대기)를 넘긴다.
  - `SkyStats.power` · `lowPower`
  - `debugState()`에 `power · evMs · wantMs · met`
- `ProgressLine`: 지금 표시가 `transform: translateX(v × 100cqw)`로 움직인다(`.gx-progress { container-type: inline-size }`). 한 걸음이 1px 미만이면 `.is-step`으로 전환 없이 옮긴다.

**측정** (1180×820 · DPR 2 · 120Hz)
- GPU ms/초: 평소 323–579 → 119–174, 깊은 대기 → 70–96, 집중 쉼 → ≈ 0.3, 활동 → 276.
- 전환 10회: 최장 9.4–16.8ms(≤ 20), 굽기 0, 긴 작업 0, 콘솔 오류 0.

**남은 일**
- 해상도 배율(×0.75·×0.6)은 오프스크린 장면 버퍼를 업샘플하는 방식으로 할 것. 캔버스 크기를 바꾸면 재굽기·타일 폐기·점 크기 변화가 따른다.
- galaxy3d 통합 때 같은 `scheduler.ts`를 쓰면 된다.

---

## 버그 수정 — 전환 뒤 비행이 멈추고 하늘이 검게 꺼짐 (2026-10-17)
- 재현 시도: 새로 연 앞 탭에서 `nav[aria-label="공간"] a`를 1.75초 간격 element.click() 7회 × 3번 + 실제 마우스 클릭 7회 → 모든 이동에서 비행·노출 전환, 검은 하늘·빈 화면 0, 최장 9.4–16.7ms, 굽기 0, 콘솔 오류 0. 깨끗한 새로고침에서는 재현되지 않았다.
- 원인(추정, 코드로 확인): 오래 열어 둔 개발 탭에서 핫 업데이트·재마운트마다 새 캔버스·WebGL 컨텍스트를 만들고 옛 것을 돌려주지 않아 브라우저 한도(16)에 걸리면 지금 보이는 하늘의 컨텍스트가 잃어져 검게 꺼지고 루프가 멈춘다(그 뒤 navs frames 0). 더불어 전환 중 모드가 '끔'으로 바뀌는 등 커밋이 건너뛰어지면 내용 페이드아웃이 opacity 0에 멈출 수 있었다.
- 고친 곳: `src/fx/sky/field.ts` detach에서 옛 캔버스 컨텍스트를 `WEBGL_lose_context`로 즉시 반납, 컨텍스트를 잃고 2초 안에 복구되지 않으면 새 캔버스로 하늘을 다시 붙임(데이터 별·선·장면 유지). `src/fx/hooks.ts` 전환: 끔 경로에서 진행 중 페이드를 취소하고 비행 붙잡기를 푼다, 1.5초 안전장치로 내용 opacity·비행 붙잡기를 반드시 복구. `src/galaxy/sky/sky.ts` kick: '도는 중'인데 예약 프레임이 없으면 다시 건다. 검증용 `__gyeolPerf.debug()`(루프·붙잡기·장면·카메라 상태) 추가.


## API 변경 기록 — 검수(review.md) 반영 (2026-10-17, 추가만)
| 이름 | 의미 · 예 |
|---|---|
| CSS 변수 `--sky-flight-ms` · `--sky-content-in-ms` | 비행이 정해질 때마다 `<html>`에 설정. 글자 들어옴 = D − 320ms(짧게·끔이면 170ms). 예: `.enter-n { animation-delay: calc(var(--sky-content-in-ms) + n * 30ms) }` (review #7) |
| `TransitionOptions.onFlight(flightMs, contentInMs)` | 같은 값을 콜백으로. `go(to, { onFlight: (d, inMs) => … })` |
| `useSkyCamera().current.durationMs` · `CameraTarget.durationMs?` | 이번 비행 길이 |
| `getSkyStats().flights` | `{ count, p95FrameMs, maxFrameMs }` 비행 전체 계측 (navUntil = D + 150) |
| `birthStar({ kind: 'small', level < 0.3 })` | **씨앗 별**: 좌석 자리에 금빛 1px 12%로 보인다. 같은 id로 `kind: 'set'`을 부르면 그 자리에서 V1으로 크게 피어난다. `growStar`는 12% → 60% |
| `useSkyPick().pick` | 반경 최소 18px |

### 바뀐 동작 (계약 그대로)
- 첫 진입(#2): 하늘이 첫 프레임에 보이기 전에는 데이터 별·선이 0. 첫 프레임 + 700ms부터 별 V3 400ms, 선 V2를 min(160, 800 ÷ n)ms 간격으로. 첫 페인트 바탕 `#04060C → #0A0E19`.
- 집중(#1·#5): 집중 장소 = 다음 별 자리가 별 좌석(iPad·데스크톱 0.64, 0.42 · 폰 0.62, 0.30)에 오도록. 'next'는 씨앗을 세지 않아 씨앗·탄생·카메라 좌석이 같은 자리.
- 복습(#4): 복습 별 사선을 세계 (0.80, 0.30) → (0.69, 0.62)(복습 장소에서 화면 0.77, 0.12 → 0.56, 0.73)로. `relight`로 밝아질 때 할로 6px 작은 피어남 + 글린트는 지금 화면 자리에.
- 그래프(#6·#14): 띠 노출 0.45, 노드 크기는 링크 수(1.2–3.2px), 선 0.28(고른 별의 선 0.6, 나머지 0.16), 노드는 세계 y 0.18–0.53(상단 바 64px·독 위), 고른 별은 금빛·밝게 + 할로 6px. 데이터 층은 비행의 0.6D → D에 들어온다. 선 중점이 글자 구역·상단 64px·독 구역이면 ×0.2.
- 설정·노트(#8): 설정 = 오늘 자리 × 노출 0.65. 노트 장소 (0.28, 0.36) · 1.4 — 띠 몸통이 아닌 바깥 헤이즈.
- 측정(1180×820, 앞에 띄운 탭, 8회 이동): 비행 p95 9.3ms, 최장 16.8ms, 비행 중 굽기 0, 콘솔 오류 0, 정지 124fps.
- 남김: 과목 성운 8%(#6), 카드가 열릴 때 복습 사선을 x ≥ 0.78로 옮기기(#4) — 앱 상태(카드 열림)를 받을 API가 필요해 다음 차례.


## 버그 수정 — 백그라운드 탭에서 자동 등급 강등 (2026-10-17)
- 원인: 가려진 탭은 rAF가 초당 1회~60Hz로 들쭉날쭉해지는데 그 간격이 등급 표본에 들어가 A→B로 강등, 강등 재굽기가 전환 중에 1회 생김.
- 수정(`src/galaxy/sky/sky.ts` measure·onVis·applyPendingTier): ① `document.hidden`·포커스 없음(`!document.hasFocus()`)·간격 > 100ms 프레임은 표본에서 빼고 그 창을 처음부터 다시 센다 ② 판정은 보이는·포커스 있는 상태의 연속 120프레임(이후 2초 창·60프레임 이상)만 ③ 자동 강등된 적이 있으면 다시 보일 때 원래 등급으로 올려 다시 잰다(세션당 2번까지, 설정에서 고정한 등급은 그대로) ④ 등급 변경 재굽기는 전환·비행·보간이 없는 유휴 프레임에만(`pendingTier`).
- 확인: 가려진 미리보기 탭에서 8초 + 이동 2회 → 등급 A 유지, 전환 중 굽기 0. 콘솔 오류 0, build 통과.


## API 변경 기록 — 3차 (2026-10-17, 추가만)
| 이름 | 의미 · 예 |
|---|---|
| `FieldProvider meteors` prop | 유성 켬·끔(기본 true). false면 자동 유성 없음, `sky.meteor()` 신호 유성은 띠가 잠깐 밝아지는 것(V13 +4%, 1.2초)으로 대체. 예: `<FieldProvider meteors={settings.meteors} …>` |
| `TransitionOptions.to` | 목적지 공간(MoodName). 주면 노출이 누른 프레임에 바로 출발. 없으면 누른 링크 href('/', '/notes' …)로 추정 |
| `useFieldTransition` (계약 그대로, 구현 변경) | **View Transition을 쓰지 않는다.** t=0 노출 출발 + `[data-gx-vt-root]` opacity 1→0(180ms, 합성 스레드) → t≈170ms 커밋 → 다음 프레임 B opacity 0→1(220ms) + **카메라 비행 출발**(커밋·첫 페인트 다음 프레임). 연타하면 아직 커밋 안 한 이동은 새 이동으로 바뀌고 하늘은 지금 위치·속도에서 이어 간다 |
| `useSkyEvent().gatherDust(target)` | **구현**(스텁 해제): 반경 300px 안 별가루 30%가 4초에 걸쳐 그 자리 쪽으로 낙하 방향을 튼다(수직에서 ≤ 25°, 속도 그대로). `null`이면 4초에 걸쳐 풀림. `'next'` = 다음 별 자리 |
| `__gyeolPerf.navs()` | 항목에 `flightMaxMs`·`flightP95Ms`(카메라가 움직이는 동안)·`commitMs`(라우트 커밋) 추가. `__gyeolPerf.sky()`에 `tiles`(구운 장소 타일 수)·`memMB`(GPU 추정) 추가. 검증용 `__gyeolPerf.birth({x,y})`·`.gather(on)`·`.fly(scene)` |
| HMR 안전 | 훅은 엔진 메서드를 옵셔널 호출(`eng.holdFlight?.()` 등)한다 — fx 핫 업데이트로 엔진 인스턴스가 바뀌어도 오류 없음 |

### 3차 최적화 · 디테일 (Apple M5, Chrome, 1180×820 · DPR 2 · 3.9MP, 미리보기 탭을 앞에 띄워 측정)
- **스파이크 원인 분리:** ① View Transition 스냅숏 동안 렌더가 멈춰 하늘 rAF가 25–50ms 끊김(긴 작업은 0 — 메인 스레드가 아니라 렌더 정지). ② 라우트 커밋(앱 React 렌더, dev 모드) 15–41ms → 앱 keep-alive 뒤 5–8ms. ③ 하늘 자체는 프레임당 GPU 1.5ms 안팎으로 원인 아님.
- **조치:** View Transition 제거(내용 opacity는 WAAPI 합성 애니메이션), 커밋은 내용이 안 보일 때(170ms), 카메라 비행은 커밋·첫 페인트 다음 프레임에 출발, 비행·노출 시계는 프레임당 최대 20ms만 나아가게(메인 스레드가 잠깐 막혀도 건너뛰지 않음).
- **결과(8회 이동 + 150ms 연타 3회):** 전환·비행 최장 프레임 **8.4–9.4ms(한 번 16.6ms)**, p95 8.4–9.3ms, 커밋 5.7–8.3ms, 비행 중 굽기 0, 긴 작업 0, 콘솔 오류 0. 정지 124fps.
- **장소 타일:** 그래프(2.3)·집중(3.0)은 시작 뒤 유휴 프레임에 고해상도 타일(RGBA16F, 화면의 0.6배 밀도 = 기본 층의 약 2배)을 4조각씩 굽는다. 비행·전환 중엔 쉬었다가 굽고, 줌이 그 장소의 55→85%일 때 섞여 들어온다(가장자리 6% 섞기). GPU 추정 75MB(층 47 + 타일 28; 낮 건판 켜면 +15).
- **희미한 별 깊이 층:** 미세 별(별 그레인) 옥타브마다 δ 0.01–0.08 — 비행 중에만 다르게 다가오고 정지하면 같다. 밝은 별·데이터 별은 기존 5층.
- **별 탄생 회절:** 4갈래를 가우시안 폭 + 끝으로 가늘어지는 모양으로(팔 11→4px, 1.2초, 불투명도 ≤ 45%).
- **그래프 노트 별:** design-v3-camera대로 세계 (0.49–0.92, 0.15–0.57)의 과목 무리 6곳에 고정, 글자 구역(x < 0.66 · y > 0.41)은 비운다.
- 동작 줄이기·끔: 카메라 `travel` 'off'(고정), 사건은 최종 상태로 즉시, 별가루 모임 없음. 절제: 비행 대신 'short'는 앱 설정으로, 전환 200ms 선형, 유성 없음, V13 +4%. (OS 동작 줄이기 에뮬레이션 도구가 없어 코드 경로로만 확인)


## API 변경 기록 — 은하 카메라 (2026-10-17, 추가만)
| 이름 | 의미 · 예 |
|---|---|
| `FieldProvider travel` prop | `'fly'`(기본) / `'short'`(줌 30% + 450ms) / `'off'`(카메라 고정, 노출 크로스페이드만). 동작 줄이기·모션 끔이면 언제나 off. 예: `<FieldProvider travel={settings.travel} …>` |
| 자동 비행 | `FieldMood preset`이 바뀌면 그 공간 장소로 비행(design-v3-camera §1 좌표: 오늘·설정 (.5,.5)·1.0 · 플래너 (.55,.47)·0.88 · 노트 (.40,.74)·1.4 · 복습 (.66,.50)·1.9 · 그래프 (.70,.36)·2.3 · 집중 (.48,.33)·3.0, 폰 값 별도). `useFieldTransition`과 같은 프레임에 출발, 길이 D = 900 + 140·|log₂(zB/zA)| + 200·거리·max(z) (900–1300ms), ease-in-out cubic, 줌은 log 공간 보간 |
| `useSkyCamera()` | `{ flyTo(target, { duration? }), back(), current }`. `target = { scene, focus?: [하늘 x, y], zoom? }` — focus 대상이 별 좌석(iPad·데스크톱 화면 0.64, 0.42 · 폰 0.62, 0.30)에 앉게 다가간다. Promise는 비행이 끝나면 풀린다. 비행 중 다시 부르면 지금 위치·속도에서 이어 간다(Hermite) |
| `useSkyPick()` | `{ pick(x, y, radius = 28) → { id, layer, sky: [x, y], screen: [px, py], dist } | null, toSky(px, py), toScreen(skyX, skyY) }`. 예: `const hit = pick(e.clientX, e.clientY); if (hit) flyTo({ scene: 'today', focus: hit.sky, zoom: 2.4 })` |
| `flightMs(a, b)` · 타입 `CameraTarget` · `Travel` | 비행 길이 공식, 타입 |
| 데이터 별 좌표 | `birthStar({ at: {x, y} | Element })`의 화면 좌표는 이제 지금 카메라 기준으로 하늘 좌표로 바뀐다(카메라를 따라 움직인다). 별자리 선(SVG)도 카메라를 따라간다 |
| `__gyeolPerf.navs()` | 비행마다 `{ bakes, maxFrameMs, p95Ms, longTasks, frames }` (비행 길이 + 150ms 동안) |

### 엔진 (src/galaxy/sky)
- 카메라 = 줌·평행 이동만(회전 0). 저절로 움직이지 않는다(누른 직후·진입 내려앉기 0.84→1.0, 1300ms만).
- 굽기 틀을 화면보다 사방 12% 넓게, 텍셀 밀도 0.85로 시작 때 한 번 굽는다(줌 0.85까지 가장자리 없음). L0 RGBA16F(띠 빛·먼지) + L1 RGBA8(별빛·미세 별 밀도), 굽는 동안만 쓰는 S·B는 RGBA8. iPad(1180×820, @2x 등급 A 기준) 상주 약 12B × 3.9MP ≈ 47MB, 굽는 동안 잠깐 +31MB → 최대 ≈ 78MB (≤ 96MB).
- 줌해도 선명: 미세 별(별 그레인)을 굽지 않고 매 프레임 월드 좌표에서 그린다. 별 크기는 화면 px로 고정, 줌하면 더 고운 옥타브 3개(1.05·0.74·0.52 css px 격자)가 차례로 풀려 나온다 — 해상되지 않던 빛이 별로 풀린다. 구운 희미한 별은 줌 1→1.8에서 75% 물러난다(커지지 않게). 먼지띠는 줌 1.05→2.2에서 심플렉스 2옥타브 디테일이 더해진다(매 프레임, 굽기 없음).
- 깊이: 밝은 별·데이터 별을 5층(δ 0·.02·.04·.06·.08)으로 나눠 층별 배율 = 줌 × (1 + δ·sin(π·진행률)) — 비행 중에만 시차, 정지하면 0.
- 비행 성능(Apple M5, 1180×820, 앞에 띄운 탭, 7개 공간 6회 + 150ms 연타 3회): **비행 중 굽기 0회, 긴 작업 0, 프레임 p95 8.4–9.3ms**, 정지 120fps. 비행 첫 프레임에 최장 25–42ms가 한 번씩 있다(라우터 커밋 + View Transition 스냅숏 프레임, 앱 React 렌더 포함) → 목표 20ms 미달, 남은 일.
- 남은 일: ① 전환 첫 프레임 스파이크(커밋을 비행 시작 다음 프레임으로 미루거나 스냅숏 범위 축소), ② 장소별 고해상도 타일(지금은 매 프레임 디테일로 대신), ③ 시차 층에 희미한 별 포함, ④ `gatherDust` 스텁, ⑤ 콘솔의 `<line> NaN` 오류는 집중 화면의 앱 쪽 SVG 선에서 나는 것으로 보인다(엔진 선은 NaN이면 그리지 않게 막았다) — 앱 개발자 확인 필요.


## API 변경 기록 (v3 은하수, 2026-10-17)

앱은 계속 `@/fx`만 쓴다. **기존 이름·시그니처는 그대로, 의미만 하늘로 바뀌었다.** 새 기능은 새 이름으로 추가만 했다.

### 기존 이름의 새 의미
| 이름 | v3 의미 |
|---|---|
| `FieldProvider` | 은하수 하늘(캔버스 1개·rAF 1개·레이어 규칙 그대로). `theme='light'`면 건판(낮) 680ms 크로스페이드, `level='off'`/OS 동작 줄이기면 정지 한 장면, `'calm'`이면 유성 없음·전환 ≤ 600ms |
| `FieldMood preset` | 하늘 장면. 노출 today 100%(06–18시 80%) · landing 100 · review 70 · planner 70 · focus 65 · settings 60 · notes 55 · graph 55 (50–100%, 한 번에 ≤ 45%p). `override.dim`만 노출 배수로 쓰고 등고선 값·`knotRef`는 무시. 레이아웃 효과에서 등록해 전환과 같은 프레임에 시작 |
| `useFieldData({ rings, load, pressure, tint })` | rings = 오늘의 별 수(선으로 이은 별자리), load = 복습 별 0–13개(30%), pressure = 시험 별(0..1 → D-14..D-0, 밝기 20→100%), tint = 반사 성운 색(섞음 ≤ 10%) |
| `useSeal()(at)` | 그 자리 별 탄생(V1 피어남). `stamp` 옵션 무시(도장 폐지) |
| `useRipple()` · `RippleSurface` | V8 손끝 별빛(그 자리 별 밝기만, 고리·물결 없음) |
| `useFieldTransition()` | 한 타임라인 450ms 전환: 하늘(V6 노출 미끄러짐)과 내용(View Transition, opacity만 A 0→180 · B 170→390ms)이 같은 프레임에 출발. 하늘 캔버스는 스냅숏에서 빠짐. 다시 누르면 하늘은 속도를 이어 받는다(Hermite) |
| `useFieldPause(active, reason)` | 'ink'·'typing': 노출 85%(300ms) + 하늘 시간 정지, drawLink는 보류함에 쌓였다가 1.5초 뒤 재생. 'overlay': V12 노출 ×0.6(200 / 260ms) |
| `useFieldKnot` | 아무 일도 안 함(옹이 폐지) |
| `FocusRing` · `GyeolRings` · `ContourRibbon` · `Stamp` | export만 유지. **앱 개발자가 `ProgressLine`으로 바꿔야 한다**(지금 Focus·Today 화면이 아직 씀) |

### 새로 추가 (design-v3-motion §5-2)
| 이름 | 상태 | 예 |
|---|---|---|
| `useSkyEvent()` → `birthStar` | 구현 (V1 할로 14→9px · 회절 11→4px 1.2초, 작은 별은 V1s) | `sky.birthStar({ id: sessionId, at: 'next', kind: 'set' })` |
| `.growStar` · `.fadeStar` · `.relight` | 구현 (밝기 보간 1s / 600ms / 800ms, `relight(..., { glint })`) | `sky.relight(card.id, 0.95, { glint: true })` |
| `.drawLink` | 구현 (SVG 1px 선 그어짐 600–900ms, 세트 완료면 +900ms 뒤, 편집 중 보류 → 최대 3개 재생) | `sky.drawLink(prevId, id, { layer: 'today' })` |
| `.meteor` | 구현 (신호 유성 20초에 1회, 뒤 60초 환경 유성 쉼, 위 40%, 최대 75%) | `sky.meteor({ kind: 'signal', size: 'sm' })` |
| `.glint` · `.swellBand` · `.select` | 구현 (V11 같은 자리 5초 1회 / V13 +8%·절제 +4% / 고른 별 +30%) | `sky.glint(buttonEl)` |
| `.gatherDust` | **스텁**(시그니처만, 별가루는 원래 낙하) | — |
| `useSkyPhase(phase)` | 구현 ('auto' = 06·18·24시, 60초 보간) | `useSkyPhase('auto')` |
| `useSkyLens(subject, color)` | 구현 (색 섞음 ≤ 10%, 다른 과목 복습·노트 별 25%) | `useSkyLens('phys', '#5CB8FF')` |
| `useSkyStars(spec)` | 구현 (today · exam · review · graph 선언형, 사건 없이 최종 상태) | `useSkyStars({ exam: { id, dday: 6 } })` |
| `SkyEntrance` · `useSkyEntrance()` | 구현 (노출 55→100% 900ms, 절제 600ms, 세션 1회) | `<SkyEntrance once="session" />` |
| `ProgressLine` | 구현 (1px 선 + 지금 1×7px, tone 'star'·'quiet') | `<ProgressLine value={0.4} label="일반물리 수업, 43분 남음" tone="quiet" />` |
| `SkyCaption` · `useSkyCaption()` | 구현 (3초, opacity만) | `caption.show('10.16 · 5세트 · 2:10', el)` |
| `SKY_TIMING` | 구현 + CSS 변수 `--sky-nav-ms --sky-out-ms --sky-in-delay-ms --sky-in-ms --sky-overlay-ms --sky-ease` | `transition: opacity var(--sky-in-ms) var(--sky-ease)` |
| `getSkyStats()` | 구현 `{ bakes, lastBakeMs, longTasksInNav, navP95Ms, tier, fps }` | 콘솔: `window.__gyeolPerf.stats()` · `.navs()` · `.bench()` · `.reset()` |

## 최적화 결과 (Apple M5, Chrome, 1180×820 CSS · DPR 2 · 3.9MP, 등급 A)
- **정적 하늘 굽기: 시작 때 2회(저해상도 0.3MP 즉시 → 고해상도 8조각을 프레임마다 나눠 굽고 300ms 크로스페이드), 화면 전환 때 0회.** 선형 HDR(RGBA16F, `EXT_color_buffer_float` 없으면 RGBA8에 sqrt 인코딩). 노출·톤매핑·색보정·보이는 별·안전 구역·건판은 매 프레임 PRESENT 유니폼.
- 셰이더: `KHR_parallel_shader_compile`로 메인 스레드를 막지 않고 컴파일, 링크 뒤 프로그램마다 4×4 워밍업 그리기. `readPixels` 동기화 제거.
- 7개 화면 12회 이동(160ms 간격 연타 포함): **긴 작업(>50ms) 0, 굽기 증가 0**, 클릭→커밋 동기 작업 5–14ms(오늘 화면 진입만 31ms, 앱 React 렌더). 프레임 비용(gl 동기 대기 포함, 전환 중 프레임 섞음 140장): 평균 1.5ms, p95 3.9ms, 최장 5.2ms. 평상시 120fps, JS 0.1ms/프레임.
- 주의: 가려진 미리보기 탭에서는 rAF·View Transition이 돌지 않아 실제 프레임 간격은 `__gyeolPerf.bench()`로 쟀다. 리더가 보이는 탭에서 `__gyeolPerf.navs()`로 전환별 최장 프레임·p95를 확인할 수 있다. 검증용 `window.__gyeolNoVT = true`면 View Transition 없이 전환.
- 결 등고선 엔진(`engine/*`)은 앱 번들에서 빠졌다(lab 전용으로 남김). `lab.html`은 이제 은하수 하늘 위에서 돈다.

---

## (이전) M0 결 등고선 엔진 기록

작성: 모션 개발자 · 2026-10-16 · 범위: `src/fx/**`, `lab.html`

## 만든 것

| 파일 | 내용 |
|---|---|
| `src/fx/index.ts` | 공개 API. 계약 이름·props·반환 타입 그대로 다시 내보냄 (타입은 `types.ts`, `MOODS`는 `moods.ts`로 옮김) |
| `engine/shaders.ts` | WebGL2 프래그먼트 셰이더 1개: 3D 심플렉스 2옥타브 → `fract`+`fwidth` 1px 등치선, 4번째마다 굵은 계곡선, aniso, 옹이 4·물결 4·`uPhase`·색조·데이터 고리·인주 번짐·숨·dim·테마 3색. 선이 3px보다 촘촘한 곳은 흐리게(무아레 방지) |
| `engine/engine.ts` | 캔버스 1개(body 직속 포털, fixed z0), rAF 루프 1개. 분위기 900ms in-out 보간, 옹이 따라오기, 물결, 와이프, 인주, 고리(1200ms ease-out, 시계 방향으로 그려짐), 테마 색 680ms 보간, 일시정지, 숨(20초)·깊은 대기(2분, 0.3배·30fps), 등급 측정·강등, 컨텍스트 손실 복구 |
| `engine/fallback2d.ts` | WebGL2 없음·컨텍스트 손실·`2D 강제` 때 Canvas 2D 마칭 스퀘어 정지 프레임 1장 |
| `hooks.ts` | `FieldMood` `useFieldKnot` `useRipple` `RippleSurface` `useSeal` `useFieldPause` `useFieldTransition` `useFieldData` `useMotionPrefs` `useIdle` |
| `components/` | `RevealText` `CountUp` `FocusRing` `Stamp` `GyeolRings` `ContourRibbon` (motion 라이브러리 없이 WAAPI·SVG로. 프레임마다 React 리렌더 없음) |
| `lab.html` + `lab/` | 실험실 페이지 (개발 전용, 빌드 입력 아님) |

**옹이 따라오기 (지적받은 버그 수정)**: 화면 어디서든 `pointermove`(마우스·터치·Apple Pencil 호버) → 목표 = lerp(프리셋 자리, 포인터, **0.92**), 스무딩 `e = 1 − 0.0005^(dt/1000)` (60fps에서 프레임당 약 0.12). 2.6초 동안 입력이 없거나 포인터가 창 밖으로 나가면 약 1초에 걸쳐 프리셋 자리로 돌아간다. 브라우저에서 확인: 포인터 (108,687) → 0.8초 뒤 옹이 (125,642).
옹이가 여럿인 분위기(graph)에서는 포인터가 4번째 옹이가 된다. `knotRef`/`useFieldKnot`로 요소에 붙여도 따라오기는 그대로(`followPointer:false`로 끔).

## 공개 API 사용 예

```tsx
<FieldProvider level={level} theme={theme} tier={tier} debug={showFps}>   {/* 루트에 1번 */}
  <RippleSurface as="main" className="stage">…</RippleSurface>             {/* 편집 영역은 바깥에 */}
</FieldProvider>

<FieldMood preset="today" knotRef={knotRef} transitionMs={1200} />         {/* 화면마다 */}
useFieldData({ rings: 5, load: 0.4, pressure: 0, tint: 'var(--s-phys)' })
const go = useFieldTransition(); go(() => router.navigate({ to }), { origin: iconEl, direction: 'forward' })
const seal = useSeal(); seal(buttonEl, { stamp: { text: '1세트', sub: '25분 집중' } })
useFieldPause(isInking, 'ink')        // 0.35로 흐려지고 정지, false 후 1.5초 뒤 재개
useFieldPause(paletteOpen, 'overlay') // ⌘K: 밝기 60%·속도 0.5·30fps (design-v2 §4-4)
<RevealText as="h1" lines={['일반물리 수업 중이에요.', '43분 남았어요.']} swapKey={situation} />
<FocusRing progress={elapsed / total} state="running" drawIn>…</FocusRing>  {/* progress = 지난 비율 */}
<GyeolRings items={week.map(d => ({ size: d.hours, color }))} grow />      {/* size = 시간, 25분 = 1겹 */}
```

- 레이어 규칙: html 배경 `--bg-0`, body transparent, 앱 루트 `position:relative; z-index:1`. `debug`면 body에 배경이 있을 때 콘솔에 경고 1줄.
- View Transition: 전환 동안만 `[data-gx-vt-root]`(없으면 `#root`)에 `view-transition-name: gx-content`를 붙이고 html은 `none` → **필드는 끊기지 않고 계속 흐르고** 내용만 180ms 나감 / 520ms 들어옴. 독·상단 바처럼 두 화면에 똑같이 있는 크롬은 앱이 자기 `view-transition-name`을 주면 깜박이지 않는다(권장).
- `Stamp`는 가장 가까운 position 있는 조상의 가운데(112px). `useSeal({stamp})`은 화면 좌표에 띄우는 별도 층(z 80).
- 인주 번짐은 10초에 1회 상한(도장은 상한 없음).

## 성능 측정값 (참고값: Apple M5 Mac, 미리보기 창, 1440×900 CSS, DPR 2)

| 등급 | 내부 해상도 | 픽셀 | fps | p95 프레임 간격 | JS/프레임 |
|---|---|---|---|---|---|
| A (자동 판정) | DPR×0.66 = 1.32× | 2.26MP | 119–121 | 8.4–9.3ms (120Hz 주기 8.3) | 0.03–0.05ms |
| B (강제) | 1.0× | 1.30MP | 60 (상한) | 17.6ms | 0.05ms |
| C (강제) | 0.8×, 1옥타브 | 0.83MP | 30 (상한) | — | 0.03ms |

- GPU 시간은 Safari에서 타이머 쿼리가 없어 직접 재지 못했다. 대신 120Hz에서 p95가 주기 이내라 A 등급에서도 GPU가 예산 안이다. **iPad 실기 측정은 아직 안 함.**
- 자동 강등: 처음 120프레임, 이후 2초마다 p95 > 1.2 × max(등급 예산, 화면 주기 p10)이면 한 단계 낮춤(세션 안에서 올리지 않음). C에서도 1.5배를 두 번 넘으면 정지 프레임. 숨은 창·스로틀된 rAF(250ms 넘는 간격)는 샘플에서 뺀다.
- 설계와 다른 점 1개: **B도 2옥타브**(설계는 1옥타브). 두 번째 옥타브가 결의 잔무늬라 빼면 화면이 확 밋밋해지고, 비용은 해상도가 지배적이라 C만 1옥타브로 했다. 강등 경로는 그대로.
- 저전력: `saveData`면 첫 등급 최대 B, 배터리 20% 이하·충전 안 함이면 A→B.

## 실험실 페이지

`http://127.0.0.1:5173/lab.html` (개발 서버에서만). 화면 아무 곳 누르면 물결, 포인터를 움직이면 옹이가 따라온다. 오른쪽 조절판(좁은 화면은 아래 시트, 오른쪽 아래 버튼으로 접기):
- **분위기** 8개(누르면 결 와이프로 전환) · 보간 400/900/1200 · 옹이를 문장 옆 요소에 고정
- **결 와이프** 이전/다음 공간 · **손길** 가운데 물결, 인주색 물결, 인주 번짐, 인주+도장(10초 상한 남은 시간 표시·초기화)
- **데이터** 고리 수 ±, load·pressure 슬라이더, 색조(과목 5색) · **정지** ink / overlay / 입력창(typing)
- **시스템** 모션 풍부·절제·끔, 테마, 등급 자동·A·B·C, FPS 표시, 컨텍스트 손실 시험(2.5초 뒤 자동 복구), 2D 정지 프레임 보기 · **상태** fps·등급·해상도·JS·p95·GPU 이름
- 아래로 스크롤: FocusRing(25초 시연, 1초마다만 갱신해도 매끄럽게), CountUp·Stamp, GyeolRings, ContourRibbon(지금 시각 슬라이더)
- 콘솔: `debug`가 켜져 있으면 `window.__gyeolField.stats()`, `.debugState()`

검증: `npm run typecheck` 통과, `npm run build` 통과(lab은 빌드 입력이 아님). 새 탭에서 앱 `/`→`/notes` 전환, lab의 프리셋 전환·와이프·물결·포인터 따라오기·인주·모션 끔·라이트 테마·등급 B/C 강제·2D 정지 프레임·컨텍스트 손실/복구·ink 정지/1.5초 재개·FocusRing을 눌러 봤고 콘솔 에러 0. 절제 모드·overlay·typing·색조는 코드 경로만 확인.

## 남은 문제

1. **iPad 실기(120Hz·Apple Pencil 호버) 측정 안 함** — 등급 판정·4ms 예산은 실기에서 다시 재야 한다. Safari의 GPU 이름은 "Apple GPU"뿐이라 첫 판정이 A이고 측정으로만 강등된다.
2. View Transition 중 두 화면에 같은 크롬(독)은 앱이 이름을 따로 주지 않으면 잠깐 흐려질 수 있다. Firefox 등 미지원 브라우저는 와이프(필드)만 하고 내용은 바로 바뀐다.
3. 스크롤 연동(옹이 y가 스크롤 0.3배) 은 따로 만들지 않았다. `knotRef`가 스크롤을 1:1로 따라가므로, 0.3배가 필요하면 앱이 knotRef 요소를 sticky 등으로 두거나 다음 단계에서 `useFieldKnot` 옵션으로 추가.
4. 집중 화면의 '밤 팔레트 고정'은 앱이 `theme="dark"`를 넘기는 방식(현재 RootLayout이 그렇게 함). 필드 자체 옵션은 없다.
5. 자동 등급은 숨은 창·느린 미리보기에서 rAF가 30fps로 스로틀되면 C까지 내려갈 수 있다(세션 안에서 회복 안 함). 실기 아닌 환경 측정은 참고만.
6. (앱 쪽 참고) 개발 서버 HMR로 `src/main.tsx`가 다시 실행되면 `createRoot` 중복 경고 + `removeChild` NotFoundError가 콘솔에 찍히는 것을 한 번 봤다. 새 탭으로 새로 열면 0개. fx 코드와는 무관해 보이며 main.tsx에 HMR 가드를 두면 사라질 것.
