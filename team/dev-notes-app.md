# 개발 노트 — 앱

## M2 앱 A(글): 편집기 · 링크 · 검색 · 템플릿 · 오늘 수업 노트 (2026-10-17)

**파일** — `src/editor/`(NotePaper 지연 로드 청크 · extensions · templates · imeTest), `src/search/`(engine · index · bench), `src/db/notes.ts`, `src/screens/Notes.tsx`·`Map.tsx`, `src/shell/CommandPalette.tsx`, `src/styles/editor.css`(청크와 함께)·`search.css`(첫 화면). 리더 허가로 `src/capture/file.ts`의 `toNote()` 몸통만 `fileMemoToNote`로 바꿈(쓰지 않게 된 import·도우미 함께 정리).

**계약 (B·백업이 쓰는 것)** — `openOrCreateNote({ title?, subjectId?, template?, classKey?, body?, assetId?, quiet? })` → `{ note, created }`(classKey → 제목 순으로 찾고 있으면 body를 끝에 붙임), `fileMemoToNote(memo)`(design-m2 2-2), `findNoteByClassKey` · `appendToNote` · `classKeyFor(subjectId, now)` · `createNote` · `saveBody` · `recomputeLinks` · `renameNote` · `deleteNote`(soft) · `docToMarkdown(doc, title?)`(그림은 `assets/<id>`). 검색 색인은 Dexie 훅(notes·noteBodies·memos)으로 스스로 따라오고, 백업 '바꾸기' 뒤에는 `rebuildIndex()`(src/search)를 부르면 확실하다.

**편집기** — TipTap 3(StarterKit: 제목 1·2, 링크·밑줄 끔 + `@tiptap/extension-list`의 TaskList/TaskItem). 툴바 없음: 마크다운 단축 + 빈 줄 맨 앞 `/` 메뉴(블록 9 + 문서가 비면 틀 2). `[[` 제안·`/` 메뉴는 @tiptap/suggestion 대신 직접 만든 `Trigger` 플러그인 — 장식 없이 상태만 알리고, `view.composing` 동안 다시 평가하지 않으며 compositionend 뒤 한 번 본다. 자리표시도 직접(`Hints`, 틀 노트는 제목 바로 다음 블록에 '남길 것' 등). 링크 = 인라인 원자 노드 `noteLink { to, title }`, 모양은 노드 장식(있는 노트 과목색 60% 밑줄 · 없는 노트 점선). 자동 저장 0.6초(조합 중 멈춤, 떠날 때·숨길 때 즉시), 밖에서 본문이 바뀌면(별가루 붙이기) 고치는 중이 아닐 때 다시 읽음. 백링크 5 + '모두 n ›'.
- 종이에 blur 20은 넣지 않았다(M1 전력 결정: 움직이는 하늘 위 backdrop-filter 제거). .86 면만.

**검색** — 한글·한자 1·2-gram + 영숫자 낱말(앞부분 일치) 역색인, 낱말마다 후보 교집합 → 원문 확인. 초성 질의는 제목 초성. 끝의 조합 중 낱자(ㅎ)는 뺀다. 1,000노트 합성(본문 92만 자, `__gyeolSearch.bench()`): 색인 62–80ms, 질의 중앙 4.1–4.9ms · 최악 10.4ms(첫 실행) / 6.2ms, 부분 갱신 0.3ms. 앱에서는 시작 1.2초 뒤 유휴 시간에 조각으로 만든다.

**⌘K** — 한 목록 8줄: 장소·명령(해석된 동작 먼저) ≤ 2 · 노트 ≤ 4 · 메모 ≤ 2 · 늘 마지막 '메모로 저장 · ‘입력어’'(B `saveMemo`). 빈 입력 = 최근 5. 노트를 고르면 `glintNotes([id])`. 명령에 '새 노트' · '별가루'(B `openDust`) 추가. 루트에 늘 있으므로 색인 예약과 새 노트 `birthStar`(onNoteCreated)도 여기서.

**한글 조합 시험** — 노트를 열고 콘솔 `await __gyeolImeTest()`(개발 빌드). compositionstart/update/end + 조합 중 Enter(keyCode 229)를 흉내 내고 12항목을 본다: 조합 중 `[[`·`/` 거르기 멈춤 → 끝난 뒤 거름, 조합 중 Enter가 문단을 자르지 않음, 조합 중 저장 0 → 끝난 뒤 0.6초에 1, 평소 Enter는 문단 나눔, '1/2'는 메뉴 아님. 12/12 통과. 실기기(iOS·Android·macOS 입력기)는 미확인.

**번들** — 편집기 청크 NotePaper 417KB(gzip 132KB) + CSS 2.3KB, 첫 화면에는 tiptap 0. 새 모듈(notes·search·templates) gzip ≈ 7KB, 바뀐 Notes·Map·⌘K 포함 A 몫 ≈ 11KB(JS, 최소화 전 측정이라 실제는 더 작음) + search.css ≈ 2KB. 전체 main JS 270.66 → 290.64KB gzip(같은 시간 B·모션 변경 포함).

**남은 일** — 노트 별 누르기(StarPress가 notes 층을 pick하지 못함: 모션), `birthStar({kind:'note'})`가 graph 층 'next' 자리에 따로 생김(notes 층 별과 겹칠 수 있음: 모션 확인), 과목 없는 노트는 하늘 과목 id `_none`으로 넘김, 노트 1,000개일 때 목록은 80줄까지만 그림(찾기 칸이 나머지).

## M2 입구 (앱 개발자 B, 2026-10-17)

- **공개 API** `src/capture/api.ts`: `saveMemo(text, { subjectId?, photo?, sky? }) → id|null`(80ms 뒤 `dust`) · `openMemo(initial?)` · `openDust()` · `guessSubjectId`. 하늘 다리 `capture/sky.ts`(RootLayout `<CaptureSky/>`가 `useSkyEvent()`를 넣고 inbox 수로 `setDust`).
- **1초 메모** `capture/MemoSheet.tsx`: 미리 마운트(inert + opacity 0), `n`·레일 ＋·폰 독 가운데 ＋ → 같은 틱에 inert 해제 + focus. 측정(키 이벤트 timeStamp → performance.now): **키 → 포커스 0.8ms, 다음 프레임 9.1ms**(배경 탭), ＋ 버튼 0.8ms. 조합 중 Enter(isComposing·229) 무시 확인. 과목 칩 자동 추정. 사진 = 파일·카메라·붙여넣기·끌어 놓기 → assets.
- **별가루함** `capture/DustBox.tsx`: 오늘 '별가루 n ›'(폰 맨 아래), 가로 오늘 = 글 구역 자리 바꿈, 그 밖 = 아래 시트. ↑↓ · Enter 노트로 · T 할 일로 · E 보관 · S 과목, '보관함 ›' 되돌리기. 할 일 = `dueAt: 0`(마감 없음). **노트로 = A의 `openOrCreateNote` 없음 → `capture/file.ts toNote()` 최소판(TODO 교체).** 오늘 '최근' 장 뺌.
- **시간표** `capture/Timetable.tsx` + 저장소 `capture/slots.ts`(계획·첫 실행 공용): 가로 세로 끌기 30분, 폰 누르기 1시간 + 손잡이, 팝오버(과목 자동완성·새 과목 색·강의실·매주), 지우기 + 5초 되돌리기. 1440에서 3칸 그리기 확인.
- **.ics** `lib/ics.ts` + `capture/IcsImport.tsx`(계획 ⋯ · 첫 실행 2단계). 시험 파일 `team/test-timetable.ics`: 6일정 → 매주 5칸(격주·한 번·종일 제외, VALARM·줄 접기·UTC 처리).
- **백업** `lib/backup.ts`(지연 로드 8.3KB gzip) + 설정 '데이터' 맨 위 `capture/BackupCard.tsx`. **왕복: 실제 DB 12표 → 임시 DB '바꾸기' → 표별 개수·해시 모두 같음(33ms). 합성 DB(사진 Blob·본문·링크·메모)도 같음, 합치기 = 더 최근 updatedAt 유지.** 콘솔: `(await import('/src/lib/backup.ts')).roundTrip()`.
- **첫 실행** `onboarding/Onboarding.tsx`: 시작 → 과목(bloomNebula) → 시간표 → `await revealGalaxy()`, 오늘 preset 'onboarding'. 건너뛰기·샘플로 시작. `?onboarding=1` = 메모리 모드(DB에 안 씀). 설정 '처음 화면 다시 보기'. RootLayout 자동 시드 제거.
- **seed v2**: 모든 id `seed-` + 글 노트 12(합계 20)·본문·링크·메모 3. '샘플 지우기' = `removeSamples()`(접두어 + M1 샘플 알려진 id).
- 남은 것: '매주' 끄기는 스키마에 없어 고정, 수업 저장 시 성운 반짝(V11) API 없음, 태블릿 화면 눈 확인 못 함.

## M1: 장소 6 · 설정 시트 · 레일 v4 · 글 구역 · 은하 시계 (2026-10-17)

**장소 · 주소**
- 장소 6: `/` 오늘 · `/notes` 노트 · `/map` 지도 · `/review` 복습 · `/plan` 계획 · `/focus` 집중 (`src/shell/spaces.ts`, preset `map`·`plan`).
- 옛 주소: `/graph` → `/map`, `/planner` → `/plan`(replace 리다이렉트), `/settings` → 오늘(`/`) + 설정 시트(링크 미리 불러오기에서는 열지 않음). `src/app/router.tsx`.
- 파일 이름: `screens/Graph.tsx` → `Map.tsx`(`MapScreen`), `Planner.tsx` → `Plan.tsx`(`PlanScreen`), `Settings.tsx`는 시트 본문 `SettingsBody`.
- `useGo`가 목적지 장소를 `to: mood`로 직접 넘긴다(href 추정에 기대지 않음).

**설정 = 시트** (`src/shell/SettingsSheet.tsx`, 상태 `useUi.settingsOpen/settingsOrigin`)
- 열기: ⌘K '설정' · 상단 점 3개 · `⌘,`/`Ctrl+,`/`,`(입력 중 아닐 때) · 주소 `/settings`. 닫기: Esc · 바깥 · 닫기 버튼. Tab 가두기, 닫으면 연 자리로 포커스.
- 가로 = 오른쪽 패널(태블릿 380 · 데스크톱 420, 높이 100%), 세로 = 아래 64%, 폰 = 아래 88%. 열려 있는 동안 `useSkySheet(true)`.
- 머리: 설정 / `밤 · 25분 · 회전 켬` / [닫기]. 움직임 섹션에 **은하 회전 · 켬 · 느리게 · 끔**(OS 동작 줄이기면 끔 고정 + 비활성). '유성' 줄과 `settings.meteors`는 뺐다.

**은하 회전** — `settings.rotation: 'on'|'slow'|'off'`(기본 on, persist) → `useEffectiveRotation()`(동작 줄이기·움직임 정지면 off) → `<FieldProvider rotation>`. ⌘K '은하 회전 켬/느리게/끔'.

**독 · 레일 v4** (`Chrome.tsx`, design-m1 2-0) — 너비 ≥ 600: 왼쪽 레일 6(`--chrome-left` 72px), 폰: 아래 독 4(오늘·노트·복습·집중) + ⌘K. 폰에서 지도에 있으면 노트 칸, 계획에 있으면 오늘 칸이 켜진다. 노트·지도 위 `노트 | 지도` 토글(폰), 오늘 맨 아래 '계획 · 시험 D-n ›' 줄(폰, 글 구역 둘째 사각형). 상단 오른쪽 아바타 → 점 3개.

**빈 하늘 드래그** — `ActiveMood`에 `drag` 필수 prop → 활성 장소만 `useSkyDrag(enabled)`. 값은 `SPACES[].drag`(오늘·지도·집중 켬, 노트·복습·계획 끔).

**글 구역** (`src/app/zones.ts`) — 숫자는 `@/fx`의 `SKY_ZONES`만 쓴다. 시작할 때 `<style id="gyeol-zones">`를 한 번 심어 장소마다 `--za-*`·`--zb-*`, 별 정보 패널에 `--zs-*`를 준다(화면 종류는 fx `zoneLayout`과 같은 미디어 쿼리). 숨은 장소도 자기 값을 가지므로 장소를 바꿔도 배치 계산이 없다. `Hero`의 기본 variant가 `zone`(글 블록 = 첫 사각형).
- 오늘·복습: 3줄(명사구 · 메타 · 동작), 지평선 줄(Periphery)은 뺐다. 계획: 한 구역에 머리(이번 주 / 과제 n · 시험 D-n / ＋ 추가) + 주간 격자(구역 높이를 채움). 노트: 노트 / 38개 · 물리 12 / 새 노트 + 목록, 가로는 종이를 둘째 사각형(가운데)에. 지도: 지도 / 별 54 · 선 87 / 과목 렌즈 칩, 별 정보는 오른쪽 아래(StarPress).

**집중 = 은하 시계** (`screens/FocusBezel.tsx`)
- `useSkyAnchor('focus-disk')`의 r(팔 고리 11.5u) × 1.22 = 링 R. SVG 속성과 `--ring-x/y/r`만 바꾸고 React는 다시 그리지 않는다. 비행 중 숨김, 앵커가 오면 320ms로 나타남, 3.2초 안에 앵커가 없으면 design-m1 자리로 대체.
- 트랙 1.5px 크림 32% · 호 2.5px #F3D29A, 12시에서 시계 방향, 1초마다. 멈춤 = 호 50%, 끝 = 600ms에 트랙 색. 숫자 mono 400 64·56·48px. 가로 = 링 왼쪽 글 구역, 세로·폰 = 링 아래 24px(폰 20px). 시간 칩 15·25·50(대기 때만).
- `useSkyClock`: 시작·멈춤·이어서·끝·초기화 때만 값이 바뀐다(매초 넘기지 않음). 달리는 중 = `{ startedAt: 처음 시작 + 멈춘 시간 합, elapsedMs: 0 }`(= 엔진 계산 elapsedMs + (지금 − startedAt)과 같은 값), 멈춤 = `{ elapsedMs: 누적, paused: true }`, 끝 = `{ elapsedMs: durationMs, paused: true }`, 대기 = null.

**뺀 것** — 토스트 '기록됨'(집중 5분 이상 끝내기), 설정 '유성', 오늘·복습·계획의 지평선 줄, 노트 과목 책등(렌즈가 대신), `useToday`의 주간 통계·지난주 비교(`week`·`weekMinutes`·`lastWeekSameSpan`·`focusYesterday`, 화면에서 쓰지 않던 통계 판 잔재). 캔버스 보드 · 표·보드 보기 · 학점 계산기 · 잔디 달력 · 탭 이탈 기록 · 함께 집중방은 코드에 없었다. '카드 1장' 토스트도 없었다. `dailyStats` 테이블은 데이터라 그대로 둠(계획의 주간 회고용).

**노트 → 복습 비행** (1440×900 · 앞에 띄운 탭 · 120Hz, 엔진 `g3dStats().flights` maxFrame): 5번 17.7 · 17.7 · 17.7 · 17.6 · 17.6ms(p95 16.9–17.6), 돌아오는 복습 → 노트 16.7–17.7ms. 모두 ≤ 20ms. 크롬(독·레일·알약·칩)에 블러를 되살려 3번 더 재도 17.6–17.7ms라 블러는 원인이 아니었다. 그 사이 바뀐 것은 복습 화면의 지평선 줄(LayoutGroup + layout 블록)과 hero-split 배치 제거라, 옛 상태의 24.9–35.6ms 원인은 그쪽으로 추정한다(옛 상태로 되돌려 재현하지는 않았다).

**집중 직접 주소·크기 변경 확인:** `/focus`를 바로 열어도 과목 · 25:00 · 시작 · 15/25/50과 링이 뜬다. 숨어 있는 동안 온 앵커를 버리던 탓에, 다른 장소에서 창 크기가 바뀐 뒤 집중으로 오면 옛 자리의 숫자와 숨은 링이 남던 문제를 고쳤다(앵커는 늘 받아 두고, 보일 때 3.2초 안에 보이는 앵커가 없으면 마지막 앵커 또는 대체 자리로 그림).

**캡처:** `team/figma-assets/m1-app/` — 장소 6 + 설정 시트 1440×900, 오늘·노트·집중 820×1180.

**전력: 블러 제거** — 움직이는 하늘 위의 `backdrop-filter`를 모두 뺐다(독·레일, 상단 알약, ⌘K, 렌즈, 복습 카드, 칩, 시트 바깥 막). `--glass`를 블러 없는 반투명 단색(밤 .78 · 낮 .84)으로. 남은 곳은 설정 시트 하나(`shell.css` `.settings-sheet`, 열려 있을 때만 마운트).


---

## 전력 최적화 (성능 엔지니어, 2026-10-17)

예산·근거는 `team/power-budget.md`에 있다. 동작·시각 결과는 바꾸지 않았다.

**계측 도구 `src/perf/**` (개발 빌드 전용)**
- `power.ts`: `main.tsx`가 `import.meta.env.DEV`일 때만 동적 import 하고 `install()`이 끝난 뒤 렌더한다. 프로덕션 번들에서 `__gyeolPower`·타이머 쿼리 문자열 0인 것을 확인했고, 청크도 늘지 않았다.
  - rAF·setTimeout·setInterval·WebGL2 draw를 감싸서 잰다: 그린 프레임/초, 깨우기/초(등록한 곳별), rAF JS ms.
  - `EXT_disjoint_timer_query_webgl2`로 GPU ms를 잰다(`measure()` 동안만).
  - 그 밖에 긴 작업, 리소스 요청, JS 힙, CSS·WAAPI 애니메이션(합성 / 메인 스레드) 표본도 남긴다.
- `probe.tsx`: `Probe`는 개발 빌드에서 `<Profiler>`, 프로덕션에서는 children 그대로다. 루트(`root`)와 7개 공간(`/`, `/notes` …)에 붙였고, 숨은 공간의 커밋을 따로 센다.
- 콘솔 명령:
  - `await __gyeolPower.measure(10)` · `.report()` · `.reset()` · `.snapshot()`
  - 3D 시제품에서는 `(await import('/src/perf/power.ts')).install()`을 먼저 실행한다.

**고친 것 (전 → 후, 1180×820 · DPR 2 · 120Hz)**

| 파일 | 바꾼 것 | 전 → 후 |
|---|---|---|
| `src/styles/screens.css` | `.focus-stage.is-running`의 진행선 `transition: none`. 매초 다시 걸리던 `left 1s linear`(배치)·`transform 1s linear`을 끈다. 한 걸음이 0.1–0.3px라 결과는 같다. 멈춤·끝·초기화 때의 전환은 그대로 | 메인 스레드 애니메이션이 돈 초 7/7 → 0/8 |
| `src/screens/Focus.tsx` | 1초 틱에서 이 공간이 비활성(keep-alive로 숨음)이면 `force` 재렌더를 생략한다. `growStar`·끝 감지는 그대로. 다시 보일 때는 활성 컨텍스트 변경으로 새 값이 그려진다 | 숨은 커밋 1/초 → 0, 숨은 진행선 전환 7/7초 → 0 |
| `src/app/RootLayout.tsx` `useClockTicker` | 탭이 숨으면 분 타이머를 멈춘다. 보이면 즉시 `bump` + 분 경계에 다시 맞춘다 | 숨김 중 깨우기 1/분 → 0, 7개 공간 재렌더·DB 재조회 → 0 |
| `src/main.tsx`, `RootLayout.Space` | 계측 붙이기(`Probe`), 개발 빌드만 | — |

**측정 요약:**
- 정지 화면은 React 커밋 0, 타이머 0, 네트워크 0이다. **전력의 거의 전부는 하늘이다**: 120fps, GPU 2.7–4.8ms/프레임, 초당 0.32–0.58초.
- 집중 실행 중: GPU 373–520ms/초, React 1커밋/초(≈1ms dev).
- 하늘 쪽 낭비(120fps 상한 없음, rAF 건너뛰기 상한, ProgressLine 전환)는 모션 개발자 몫으로 power-budget §4에 적었다.

**2차 (같은 날):** `Settings`의 '지금 A · n fps' 글을 잎 컴포넌트 `TierHint`로 뺐다. 하늘이 fps를 알릴 때마다 숨은 설정 화면 전체가 다시 그려지던 것(dev 기준 5커밋·20ms/8초)을 잎 하나로 줄였고, 숨은 동안에는 마지막 글을 그대로 둔다. 하늘 전력 상태는 dev-notes-fx 맨 위와 power-budget §7에 있다.

**고치지 않은 것:** keep-alive 숨은 공간이 분 시계마다 다시 그려진다(≈15ms/분 dev). 활성 컨텍스트를 구독하게 바꾸면 전환 커밋 프레임에 일이 늘어서 그대로 두었다.

**검증:** `npm run build` 통과(타입 오류 0). 콘솔 오류 0. 집중 시작·이동·초기화 확인. 측정 뒤 타이머는 기록 없이 초기화했다(`reset`).

---

## 검수 반영 (team/review.md, 2026-10-17)

| # | 반영 |
|---|---|
| ① 집중 | 왼쪽 글자 구역: 과목 Hahmlet 300 32px `--text-2`, 타이머 Fraunces 200 ≈168px(iPad)/104px(폰), 진행선 폭 480, 버튼·시간 칩 왼쪽. 위 여백 iPad 30svh(≈y250) · 폰 51svh(≈y430). 별 좌석(0.64, 0.42)은 비워 둠. 별 위치·크기는 fx 몫 |
| ③ 셸 | 심볼 v3(57° 사선 별 5개 + 인주 점), 아이콘 선 1.5px, 오늘 = 지평선 + 별, 집중 = 모래시계. 독/레일 활성 = 아이콘 `--text-1` + 아래 6px 별빛 점 3px(원형 배경 없음). ⑯ 상단 왼쪽은 심볼만(공간 이름은 sr-only) |
| ④ 복습 | 가운데 → 왼쪽(가로 화면 y≈35svh, 최대 46vw). 진행 중 카드도 왼쪽, ⑲ 카드 메타("● 영어 · 1 / 13")는 카드 안. ⑪ 평가 글자 `--text-2`, 누름만 별빛 금 |
| ⑦ 글자 박자 | `useGo`가 출발·도착 장소(design-v3-camera §1)로 `flightMs`를 계산해 `--enter-base = max(170, D − 320)ms`. 다시 보이는 공간 전체가 그 지연 뒤 290ms opacity로 들어온다(keep-alive라 공간 단위). 짧게·끔·절제면 170ms. fx가 비행 길이를 직접 알려 주면 그 값으로 바꾸면 된다 |
| ⑧ 노트·설정 | 종이 면 `--paper`(밤 #10141F) 92%, 블러 없음. 노트 글자는 가로 화면에서 위쪽(띠 꼬리 밖). 설정은 한 열 왼쪽 정렬 |
| ⑨⑩⑫⑬㉑ | 주 버튼 화살표 제거 · 지평선 줄은 첫 항목만 점, 나머지 '·' · 노트 '최근'은 스크롤 아래 장으로 · 플래너 칸 배경 제거, 메타 "마감 n" = 목록 수 · 개발용 문구 "상황 바꾸기", "별 탄생 시험" |
| 공통 | `--gutter` = clamp(24px, 5.4vw, 64px) → iPad x64 · 폰 x24 |

- 시드 되돌림: 샘플 다시 넣기 → 복습 13장 · 8분 확인.
- 측정(1180×820, 앞 탭, 120Hz): 10회 이동 maxFrameMs 9.4 × 9, 16.8 × 1, 긴 작업 0. (숨은 탭에서는 rAF가 느려져 수백 ms로 찍힌다 — 앞에 띄워 재야 한다.)
- `npm run build` 통과, 콘솔 에러 0, 1180 가로 스크롤 0.
- 남김: ②⑤⑥⑭⑳(fx 담당), ㉒(리더 확인), 유성 켬·끔(fx API 필요). Figma 07의 아이콘 SVG 원본은 로컬에 없어(figma-assets엔 하늘 렌더만) 설명대로 새로 그렸다 — 원본과 다르면 교체 필요.

---

## v3 재개: 카메라 연결 · keep-alive (2026-10-17)

**고친 것**
- 집중 화면 `<line> NaN`: 집중 끝의 별자리 선을 DB의 '마지막 세션'(하늘에 없을 수 있음)이 아니라 **하늘에 이미 떠 있는 오늘의 마지막 세트**에서만 긋는다(없으면 긋지 않음). 집중 장면에도 오늘의 별 층(`stars.today`)을 선언해 직전 별이 늘 하늘에 있게 했다. 시작·일시정지·끝내기를 돌려 콘솔 NaN 0 확인.
- 빈 상태 메타를 작은 줄로(`EmptyState` = 명사구 + `.meta`), 상단 바 '검색·명령' 글자 → ⌕ 아이콘(읽기용 이름은 유지), 날짜 표기 `10.16`.

**은하 카메라 연결**
- 설정 > 움직임 > **공간 이동: 비행 · 짧게 · 끔** (`settings.travel`, persist) → `FieldProvider travel`. 움직임 '정지'나 OS 동작 줄이기면 `off`, OS일 때는 선택지 비활성 + "기기 설정 · 동작 줄이기". ⌘K 명령 "공간 이동 비행/짧게/끔".
- `src/shell/StarPress.tsx`: 빈 하늘을 누르면 `useSkyPick().pick(x, y, 손가락 22 / 포인터 14)` → 맞으면 `useSkyCamera().flyTo({ scene, focus: 별, zoom })`로 다가가 왼쪽 글자 구역에 명사구 / 메타 / 동작(design-v3-camera §3), 보던 화면 글은 opacity로 물러남. 오늘의 별(×2.4: 과목 / `10.16 06:50 · 25분` / 노트 열기) · 시험 별(×2.4: 제목 / `10.22 · D-6 · 범위 42` / 범위 복습) · 복습 별(3.0: 카드 앞면 / 과목 · 내일 다시 / 이 카드 복습) · 그래프 별(3.4: 개념 / 과목 · 링크 n / 열기). 별 → 별은 옆으로, 닫기(× · Esc · 빈 하늘) = `back()`(여러 번 옮겼으면 처음 자리로 `flyTo`). 동작을 누르면 그 공간으로 이어서 난다. 포인터가 별 위면 커서가 바뀐다(rAF당 pick 1회). 1180에서 오늘의 별을 눌러 다가감·한 줄·Esc 복귀 확인.
- 아직: 키보드 Tab으로 별 고르기, 호버 캡션(연결 지도 33·44행), '나의 별(지난 날)'.

**전환 성능 (keep-alive)**
- `src/app/keepAlive.tsx` + `RootLayout.KeepAlive`: 처음 연 공간만 바로 마운트, 나머지는 1.4초 뒤 유휴 시간에 숨긴 채 하나씩 마운트(라우트 컴포넌트는 빈 것, 화면은 RootLayout이 그림). 비활성 공간 = `visibility:hidden; position:absolute` + `inert` + `aria-hidden` — **배치를 유지**해서 다시 보일 때 레이아웃 계산이 없다(`hidden`/display:none은 25–33ms가 남았음).
- 하늘에 말하는 것(FieldMood·데이터 별 값·데이터 별 층·떠날 때 정리)은 잎 컴포넌트 `ActiveMood`로만: 활성일 때만 렌더, 화면 전체는 활성 여부로 다시 그려지지 않는다(`Space`가 화면 요소를 메모). 같은 별 층은 다시 활성화될 때 재동기화하지 않음.
- **측정(1180×820, 앞에 띄운 탭, 120Hz, `__gyeolPerf.navs()`), 7개 공간 16회 이동: maxFrameMs 9.4ms × 15회, 15.7ms × 1회(전부 ≤ 20ms), p95 ≤ 9.3ms, 긴 작업 0, 굽기 0.** (keep-alive 전 25–49ms, display:none 방식 9.3–33ms)
- 주의: HMR로 fx만 바뀐 뒤에는 옛 엔진 인스턴스와 새 hooks가 섞여 `eng.holdFlight is not a function`이 날 수 있다 → 새로고침하면 0.

**검증:** `npm run build` 통과(타입 오류 0). 390/820/1180/1440에서 7개 공간 가로 스크롤 0, 콘솔 에러 0(NaN·TypeError 패턴 포함).

**남은 일:** 설정 '유성: 켬 · 끔'(fx에 끄는 API 없음 → 모션 개발자에게 prop 요청 필요), 별 키보드 선택·호버 캡션, '나의 은하' 시트, 오프라인 새로고침 확인(preview 서버 필요).

---

## v3 은하수 통합 (2026-10-17, 사용량 91%에서 정리)

**바뀐 점**
- 토큰: 별빛 금 `--accent #F3D29A`(낮은 버튼 면 `#1B2340` + 금 글자), `--seal #FF8F78`(시험 별만), 하늘 바탕 `#070A14`(theme-color·매니페스트 포함), 유리 `rgba(10,14,26,.55)` + blur 20 + saturate 1.2, 하늘 위 글자 그림자. `tokens.css` 끝의 v3 덮어쓰기 블록.
- 글꼴 굵기: 명사구 Hahmlet 300(40→72px), 집중 숫자 Fraunces 200 opsz 144, 메타·지평선 줄 JetBrains Mono 300 13px.
- 글 다이어트(design-v3 4-2): `lib/situation.ts`를 `title / meta / progress / primary / quiet / peri(지평선 ≤ 3)` 형식으로 다시 씀. 상황 9개 문구가 표와 같음(예: 수업 중 `일반물리 / 09:00 – 10:15 · 공학관 302` + 진행선 / 노트 열기 · [마이크] / `13:00 공업수학 · 복습 13 · 중간고사 D-6`). 머리말·"~요" 문장·자랑·비교·% 없음. 노트·그래프·복습·플래너·집중·설정·⌘K·토스트 문구도 표대로("M1에서 열림", "샘플 넣음", "결과 없음 · 예: 물리 25분", 하늘: 밤·낮·시스템, 움직임: 풍부·절제·정지).
- 원형 모티프 제거: 화면에서 FocusRing·GyeolRings·ContourRibbon·Stamp·CountUp 사용 0. 오늘 아래 장은 '최근' 하나(제목 3 + 과목·시각 + 모두 →). 집중은 큰 숫자 + `ProgressLine`(star), 수업 중은 `ProgressLine`(quiet). 그래프의 SVG 별자리 삭제 → 하늘이 그림.

**연결한 하늘 사건**
| 기능 | 사건 |
|---|---|
| 집중 시작 · 진행 · 세트 끝 · 포기 | `birthStar(small, level .08)` → 1초마다 `growStar` → `birthStar(set)` + 직전 세션 별과 `drawLink(today)` → `fadeStar` (5분 넘게 했으면 작은 별로 기록) |
| 복습 | 오늘 카드 = `useSkyStars({review})`(희미 .3), 평가 = `relight`(다시 .35 · 어려움 .6 · 좋음 .85 · 쉬움 1 + glint), 복습 끝 = `swellBand` + `meteor(signal)` |
| 오늘 | `useSkyStars({ today: 오늘 세션, exam: 가장 가까운 시험(D-14 이내) })`, `useFieldData`(rings·load·pressure·tint), 하늘의 별 영역을 누르면 `SkyCaption` "10.17 · 5세트 · 2:10" |
| 그래프 | `useSkyStars({ graph })` 노드 54 · 선 87, 누르면 캡션 "별 54 · 선 87" |
| 시간대 · 렌즈 · 첫 진입 | `useSkyPhase`(실시간 auto, 시각 고정이면 night/dawn/blue), `useSkyLens(lens, 과목색)`, `<SkyEntrance once="session"/>` |
| ⌘K | 기존 `useFieldPause(open, 'overlay')` 그대로(노출 ×0.6) |

**검증:** `npm run build` 통과(타입 오류 0, precache 12). 새 탭에서 7개 화면 이동 + 390 폭: 콘솔 error/warn 0, 가로 스크롤 0. 1180에서 오늘(새벽)·집중 화면 눈으로 확인.

**남은 일 (사용량 한도로 멈춤)**
1. **전환 성능(목표 최장 프레임 ≤ 20ms) 손대지 못함.** 계획: RootLayout에서 7개 공간 keep-alive(한 번 마운트, `hidden`/`inert`로 보이기만 전환) + 각 화면의 `FieldMood`·`useSkyStars`·전역 키 처리를 '활성 공간일 때만' 켜는 `ActiveSpace` 컨텍스트. 그래프·시간표 격자는 첫 프레임 뒤 렌더. `__gyeolPerf.navs()` maxFrameMs로 측정.
2. **은하 카메라 미연결:** `useSkyCamera`가 아직 fx에 없음. 생기면 별 누르기(오늘의 별·복습 별·노트 별) → `flyTo` + 한 줄 캡션, 닫기 → `back()`, 설정 '공간 이동: 비행 · 짧게 · 끔' → FieldProvider 전달.
3. 설정 '유성: 켬 · 끔', 별자리 길게 눌러 '나의 은하' 시트, 노트 `drawLink` 보류(편집기 M1), `gatherDust` 미사용.
4. 빈 상태(`EmptyState`)는 명사구·메타가 둘 다 큰 글자로 나온다 → 메타를 작은 줄로 바꾸기. 상단 바 '검색·명령' 글자 → [⌕] 아이콘. 독 아이콘 v3 선 굵기 조정은 Figma 확인 뒤.
5. 오프라인 새로고침(preview 서버)은 이번에도 실행하지 않음.

---

## (이전) M0 기반 셸

작성: 앱 개발자 · 2026-10-16 · 범위: `src/**`(fx 제외) · `index.html` · `vite.config.ts` · `public/**`

## 구조

| 위치 | 내용 |
|---|---|
| `src/main.tsx` | 진입점. 루트는 한 번만 만든다(`#root.__gyeolRoot` 재사용 → HMR 중복 `createRoot` 방지) |
| `src/app/router.tsx` · `RootLayout.tsx` | TanStack Router 코드 기반 7개 라우트(`/ /notes /graph /review /planner /focus /settings` + 404). 루트: `FieldProvider`(level·theme·tier·debug는 설정 스토어) → `MotionConfig` → 상단 바 · `RippleSurface as="main"`(+`data-gx-vt-root`) · 독 · ⌘K · 토스트. 1분마다 + `visibilitychange` 시계 갱신, 첫 실행 시드, `navigator.storage.persist()` |
| `src/shell/` | `Chrome.tsx`(상단 바·과목 렌즈·독/레일·토스트), `CommandPalette.tsx`(cmdk), `hooks.ts`(`useGo` = `useFieldTransition`으로 감싼 이동 + origin, 스크롤 숨김, 미디어 쿼리), `spaces.ts`, `icons.tsx` |
| `src/screens/` | `Today` `Notes` `Graph` `Review` `Planner` `Focus` `Settings` `NotFound` + 공용 `parts.tsx`(Hero·FocusLines(RevealText)·주 버튼·조용한 버튼·주변부+선반·장·Reveal), `actions.ts` |
| `src/db/` | `schema.ts`(Dexie 4: subjects·courseSlots·tasks·notes(메타)·cards·focusSessions·dailyStats·meta, 획 `t` 저장 주석), `seed.ts`(도윤·2학기 7주차), `hooks.ts`(useLiveQuery: `useNow` `useToday` `useReview` `usePlanner` `useNotes` …) |
| `src/stores/` | `settings.ts`(zustand persist, 키 `gyeol-settings`, localStorage try/catch), `ui.ts`(팔레트·렌즈·토스트·크롬 숨김·의도), `focus.ts`(타이머, 시각 차 계산, persist) |
| `src/lib/` | `situation.ts`(상황 엔진 8개 + 예외), `parser.ts`(v1 자연어 파서 이식), `hangul.ts`(초성 검색), `time.ts`(새벽 4시 경계), `theme.ts`(원형 리빌), `ai.ts`(AiClient 인터페이스만) |
| `src/styles/` | `tokens.css`(design.md 값 그대로, 다크 기본/라이트), `base.css`(레이어 규칙·포커스 링·동작 줄이기), `shell.css`, `screens.css` |
| `public/` | `favicon.svg/.ico`, `icon.svg`, `pwa-192/512.png`, `pwa-maskable-512.png`, `apple-touch-icon.png`(결 심볼: 동심 고리 3겹 + 인주 점, 의존성 없는 스크립트로 생성) |

## 실행

- 개발: `npm run dev` → http://127.0.0.1:5173 · 빌드(타입 체크 포함): `npm run build` · 미리보기(PWA 확인): `npm run preview`
- 시연: 설정 > 개발용(개발 서버 또는 `?dev`) > **시각 고정** — 실시간 / 아침 08:10 / 수업 중 09:32 / 공강 11:00 / 수업 직전 12:50 / 밤 22:10 / 새벽 01:40 / 시험 D-3 / 빈 상태. 같은 곳에 필드 등급 강제, FPS 표시, 완료 연출(인주+도장) 시험, 샘플 다시 넣기.
- ⌘K 예: `물리 25분`(→ 집중 화면 자동 시작), `ㅇㅌㄹㅍ`(초성), `과제 추가 공업수학 금요일 23:59`(→ DB에 저장, 플래너·오늘 D-day에 반영), `라이트`, `모션 끔`.

## M0 완료 기준

| # | 기준 | 상태 |
|---|---|---|
| 1 | build 성공·타입 오류 0, dev 콘솔 에러 0 | **충족** — `npm run build` 통과. 390/820/1180/1440에서 7개 화면·⌘K·테마·집중·복습을 돌린 뒤 콘솔 error/warn 0 |
| 2 | 6개 공간 이동·URL 라우팅·새로고침 유지 | **충족** — 독/레일/⌘K/링크 이동, 각 URL 직접 열기·새로고침 확인 |
| 3 | 4개 폭에서 셸 전환·가로 스크롤 0 | **충족** — 390: 아래 독 6칸(그래프는 노트 위 토글), 820·1180: 아래 독 7칸, 1440: 왼쪽 레일(호버 시 이름). 모든 화면 `scrollWidth = innerWidth` |
| 4 | 화면마다 필드 분위기·누르면 물결·전환 연출 | **충족** — 화면마다 `FieldMood`, `RippleSurface`, `useFieldTransition` + 누른 아이콘 origin. 크롬은 `view-transition-name`(topbar·dock)으로 전환 중 흐려지지 않게 |
| 5 | 오늘 = 한 초점 + 시드 | **충족** — 상황 엔진 8개 확인(예: 09:32 "일반물리 수업 중이에요. / 43분 남았어요." + 다음 13:00 공업수학 · 복습 13장·8분 · 중간고사 D-6). 상자 0·큰 숫자 1·인주 버튼 1. 아래 3개 장(ContourRibbon·GyeolRings·이어서 하기) |
| 6 | ⌘K 어디서나·이동·테마 | **충족** — ⌘K/Ctrl+K·독 ⌘·상단 바 버튼. 이동/명령/렌즈/노트 그룹, 해석 칩+미리보기, 초성, IME Enter 보호, 폰은 아래 시트 |
| 7 | 테마·모션 설정 동작·저장, OS 동작 줄이기 즉시 | **충족(OS 부분은 코드 경로만)** — 다크/라이트/시스템 원형 리빌, 새로고침 유지·깜빡임 방지 스크립트. OS `prefers-reduced-motion`은 미디어 쿼리 구독으로 즉시 'off' + 안내 문구·선택 비활성. OS 설정은 직접 바꿔 보지 못함 |
| 8 | Dexie 스키마·시드·새로고침 후 유지 | **충족** — 첫 실행 시드, ⌘K로 넣은 과제·집중 기록이 새로고침 뒤에도 남음 |
| 9 | PWA 설치·오프라인 셸 | **부분** — 매니페스트(이름 '결', 테마색 #0B0C0E, PNG·SVG·maskable 아이콘), 자동 업데이트 SW, precache 12개(index.html·JS·CSS·아이콘, 중복 0), `navigateFallback`, Google Fonts 런타임 캐시를 빌드로 확인. **`npm run preview`에서 오프라인 새로고침은 '다른 서버 띄우지 말 것' 지시로 실행하지 않음** → 리더 확인 필요 |
| 10 | 숨은 탭 정지·4ms 예산 | **fx 소관** — 앱은 FieldProvider 하나만 두고 프레임마다 React를 다시 그리지 않음(타이머 1초 갱신). 실기 측정은 dev-notes-fx 참고 |

## 남은 문제

1. 번들 1개 734KB(gzip 241KB) — 경고만. M1에서 라우트별 `lazy` 분할 권장.
2. 미리보기 탭이 백그라운드일 때는 합성이 멈춰 WAAPI·CSS 애니메이션이 스크린샷 순간에만 진행됨(타임라인 0 고정 확인). 앱 버그 아님, 실제 브라우저 앞 탭에서 모션 품질 확인 필요.
3. 시각 고정은 '시드 기준일'로 시계를 옮긴다. 그 상태에서 새로 기록한 집중·복습(실제 시각)은 고정 화면에 안 보인다.
4. M1로 미룬 것: 노트 편집기·필기(이어서 쓰기·새 노트는 안내 토스트), 시간표 편집, 백업/복원, FSRS(복습은 고정 간격 1/2/4/7일 임시판), 스크롤 연동 옹이(0.3배), 펜 필기 시 3px 결 줄.
5. 그래프 별자리는 개념 목록에서 결정적으로 생성한 M0 표시용(노드 54·링크 87). 실제 링크 색인은 이후.

- (모션 개발자, 2026-10-17) 전환 뒤 하늘이 검게 꺼지는 버그는 fx 쪽에서 고쳤다(옛 WebGL 컨텍스트 반납·잃으면 다시 붙임·전환 안전장치). 앱 파일(`src/shell/hooks.ts`, RootLayout keep-alive)은 고치지 않았다 — 원인이 아니었다. 상태 확인은 `__gyeolPerf.debug()`.
