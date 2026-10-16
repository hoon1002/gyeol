# STUDY OS 기술 설계서 (architecture.md)

작성: 기술 설계자 · 2026-10-16 · 상태: 초안 v1 (기획 단계, 코드 없음)
버전 표기는 2026-10 웹 검색 기준의 "대략" 값이다. 착수 시 `npm view <패키지> version`으로 다시 확인하고 고정(pin)한다.
단계 표기(MVP / v1 / v2)는 `team/plan.md` §4를 따른다. 기획서·조사 보고서와의 연결은 12장에 정리.

---

## 0. 한눈에 보기

| 영역 | 추천 | 한 줄 이유 |
|---|---|---|
| 형태 | 로컬 우선 SPA + PWA, 정적 호스팅 | 서버·비용 0원, 오프라인 동작, 홈 화면 설치 |
| 빌드 | Vite 8 + React 19 + TypeScript | 에디터·그래프·3D 생태계가 React에 가장 두텁다 |
| 라우팅 / 상태 | TanStack Router v1 / Zustand + Dexie liveQuery | 타입 안전 URL, DB가 곧 진실의 원천 |
| 손글씨 | **자체 엔진**: Pointer Events + perfect-freehand + Canvas 2D 타일 + rbush | 굿노트급 지연·제어를 위해 직접 만든다 |
| PDF | pdf.js(pdfjs-dist) 렌더 + pdf-lib 내보내기 | 표준, 무료, 모질라 유지보수 |
| 블록 에디터 | TipTap v3 (ProseMirror) | 커스텀 노드(위키링크·수식·필기 블록) 자유도 + 성숙도 |
| 그래프 | sigma.js v3 + graphology (전체), d3-force (로컬 그래프) | 수천 노드는 WebGL, 소규모는 연출 중심 |
| 데이터 | Dexie 4 (IndexedDB) + 저장소 인터페이스 | iOS 포함 전 브라우저, 특수 헤더 불필요 |
| 검색 | FlexSearch 0.8 + 한글 2-gram 토크나이저 (Worker) | 한국어 부분 일치, 속도 |
| 복습 | ts-fsrs 5.x (FSRS-6) | 안키 최신 알고리즘의 TS 구현 |
| 타이머 | 시각 차 계산 + Web Worker + 알림 | 백그라운드 탭에서도 기록 오차 ±1초 |
| 모션 | Motion 12(UI) · GSAP 3(타임라인·스크롤) · View Transitions(화면 전환) · three.js+R3F(WebGL, 지연 로드) | 역할을 나눠 번들·성능 통제 |
| 미래 확장 | Yjs(CRDT) 동기화 · 서버리스 AI 게이트웨이 | 경계만 지금 설계, 구현은 나중 |

---

## 1. 전제와 시스템 경계

**원칙**: (1) 모든 데이터는 기기 안(IndexedDB)에 먼저 저장된다. (2) 네트워크가 없어도 모든 핵심 기능이 동작한다. (3) 서버가 필요한 기능(AI, 동기화)은 인터페이스 뒤에 숨기고 기본값은 "꺼짐".

```
┌──────────────── UI 레이어 (React 19 · 라우트별 코드 분할) ────────────────┐
│ Shell · 노트북 · 문서 에디터 · 필기 캔버스 · PDF · 그래프 · 복습 · 집중 · 통계 │
└──────┬──────────────────────── useLiveQuery / 명령(command) ──────────────┘
┌──────▼──────── 도메인 서비스 (순수 TS, React 비의존 → 테스트 쉬움) ────────┐
│ ink-engine │ doc-service │ link-indexer │ srs(ts-fsrs) │ timer │ stats    │
└──────┬───────────────────────────────────────────────────────────────────┘
┌──────▼──────── Repository 인터페이스 ───────┐   Web Workers:
│ Dexie(IndexedDB) · Blob/OPFS(PDF·이미지)    │   search · graph-layout · pdf · 타일 렌더 · timer
└──────┬──────────────────────────────────────┘
       ├─(나중) SyncAdapter ──► 동기화 서버 (Yjs/Hocuspocus 등)
       └─(나중) AiClient ─────► AI 게이트웨이(서버리스, 키는 환경변수) ──► LLM
```

| 결정 | 추천 | 대안 | 이유 |
|---|---|---|---|
| 호스팅 | Cloudflare Pages (무료) | GitHub Pages, Netlify/Vercel 무료 | `_headers`로 CSP 등 헤더 지정 가능, 나중에 같은 곳에서 Workers로 AI 게이트웨이. GitHub Pages는 헤더 지정 불가 |
| PWA | vite-plugin-pwa 1.3+ (Workbox, Vite 8 피어 지원 추가됨) | Serwist, 수동 서비스워커 | 프리캐시·업데이트 프롬프트가 기본 제공 |
| ID | 클라이언트 생성 ULID/UUIDv7 | 자동 증가 정수 | 오프라인 생성·미래 동기화 시 충돌 없음 |
| 보안 기본 | 엄격 CSP, 붙여넣기·가져오기 HTML은 DOMPurify로 정화, KaTeX `trust:false` | — | 사용자 콘텐츠가 많은 앱이라 XSS가 1순위 위협 |

배포 자체는 사용자 승인 후 진행(이번 단계에선 하지 않음).

---

## 2. 프레임워크 · 빌드 · 라우팅 · 상태

| 항목 | 추천 | 대안 | 고른 이유 |
|---|---|---|---|
| 빌드 | **Vite 8** (2026-03 안정판, Rolldown 번들러) | Next.js 16(정적 export), SvelteKit 2 | SSR이 필요 없는 로컬 앱. Next는 서버 기능을 못 쓰는데 무게만 늘고, SvelteKit은 번들이 작지만 TipTap React·R3F·BlockNote 같은 핵심 생태계가 React 중심 |
| UI | **React 19** + TS(strict) | Preact, Solid | 라이브러리 호환성. 고빈도 영역(필기)은 React 밖에서 돌려 성능 문제 회피 |
| 라우팅 | **TanStack Router v1** (1.16x) | React Router 7 | URL 파라미터·검색 파라미터가 타입 안전, 라우트 단위 지연 로드 |
| 전역 상태 | **Zustand 5** (UI 상태: 도구, 패널, 테마) | Jotai, Redux Toolkit | 작고 단순, React 밖(ink-engine)에서도 구독 가능 |
| 영속 데이터 | **Dexie liveQuery** 훅 | TanStack Query | DB 변경이 곧 화면 갱신. 별도 캐시 계층 불필요 |
| 접근성 UI 기본기 | **React Aria Components** 또는 Radix Primitives | 직접 구현 | 키보드·스크린리더 대응된 메뉴/다이얼로그 위에 자체 디자인을 입힘 |
| 스타일 | Tailwind CSS v4 + CSS 변수 토큰 | CSS Modules, vanilla-extract | 디자이너 토큰(design.md)을 CSS 변수로 그대로 이식 |

라우트 예: `/` 대시보드 · `/c/:courseId` 과목 · `/n/:notebookId/p/:pageId` 페이지 · `/graph` · `/review` · `/focus` · `/stats` · `/settings`. 패널 분할 상태는 검색 파라미터(`?right=backlinks&split=pdf:abc`)로 표현해 새로고침·공유에도 복원된다.

---

## 3. 손글씨 엔진 (가장 어려운 부분)

### 3.1 기성품 vs 자체 제작

| 선택지 | 판단 |
|---|---|
| **자체 엔진 (추천)** | 페이지형 노트(굿노트식) + PDF 좌표계 + 압력 필기는 기성 화이트보드와 요구가 다르다. 지연·팜 리젝션·저장 형식을 직접 통제해야 "압도적" 품질이 나온다 |
| tldraw SDK | 완성도 높지만 상용 배포 시 워터마크 유지 또는 유료 라이선스 필요(비공개 가격). 무한 화이트보드 중심 |
| Excalidraw | MIT, 하지만 손그림 스타일 화이트보드라 필압·PDF 필기용이 아님 |

### 3.2 입력: Pointer Events

| 기능 | 구현 |
|---|---|
| 펜/손가락 구분 | `pointerType`: `pen` → 그리기, `touch` → 펜 모드에선 이동·확대만, `mouse` → 그리기(데스크톱) |
| 압력·기울기 | `pressure`(0~1), `tiltX/Y` 또는 `altitudeAngle/azimuthAngle` → 선 굵기·형광펜 각도에 반영 |
| 팜 리젝션 | 펜이 한 번이라도 감지되면 "펜 모드" 자동 전환: 터치는 그리지 않음. 펜 접촉 중 들어온 터치는 무시. 설정에서 "손가락으로도 그리기" 토글 |
| 제스처 | 두 손가락 핀치 줌·팬, 두 손가락 탭 = 실행 취소, 세 손가락 탭 = 다시 실행 |
| 브라우저 기본 동작 차단 | 캔버스에 `touch-action:none`, `-webkit-user-select:none`, `-webkit-touch-callout:none`, `setPointerCapture` |
| 펜 호버 | iPad 펜 호버(버튼 0인 pen 이벤트)로 커서 미리보기 |
| **iPad 대비책** | Safari에서 Pencil의 pointermove가 성기다는 보고가 있다. 실기기 측정 후 필요하면 Touch Events 경로(`touchType==='stylus'`, `force`, `altitudeAngle`)로 바꿀 수 있게 입력 어댑터를 분리 |

### 3.3 120Hz 지연 최소화

| 기법 | 지원 현황(2026) | 사용법 |
|---|---|---|
| `getCoalescedEvents()` | Chrome·Firefox, Safari 18.2+ (보안 컨텍스트 전용) | 프레임 사이에 합쳐진 점을 모두 회수 → 곡선이 매끄러움. 기능 탐지 필수 |
| `getPredictedEvents()` | Chromium 중심, Safari 미확인 | 예측 점을 "임시 꼬리"로만 그리고 다음 이벤트에서 버림. 없으면 속도 기반 1~2점 선형 예측으로 대체 |
| `getContext('2d',{desynchronized:true, alpha:false})` | Chromium(Windows·ChromeOS·Android)에서 효과, 그 외는 무시됨 | 라이브 레이어만 컴포지터 우회 |
| `pointerrawupdate` | Chromium | 고빈도 점 수집(가능할 때만) |
| React 우회 | — | 스트로크 중에는 setState 금지. ink-engine이 캔버스를 직접 그림, 끝난 뒤에만 DB 저장 |
| GC 억제 | — | 점 버퍼를 미리 할당한 Float32Array로 재사용 |

목표: 펜 이동 → 화면 반영이 "다음 프레임 안"(120Hz면 약 8ms 추가 이내). 측정은 `performance.now()`로 이벤트 시각과 rAF 시각 차를 기록하는 디버그 오버레이.

### 3.4 스무딩 · 렌더링 · 무한 캔버스

- **스무딩**: perfect-freehand 1.2.x (MIT, 기능이 완성돼 업데이트는 드묾). 점 + 압력 → 외곽 다각형 → `Path2D` 채우기. 대안: 직접 구현한 Catmull-Rom + 1€ 필터(떨림 제거). 펜 종류: 만년필(압력 강), 볼펜(압력 약), 형광펜(고정 폭, `multiply` 합성, 글자 뒤 레이어).
- **레이어 4장**:

```
[오버레이]   올가미·선택 박스·펜 커서 (가벼움)
[라이브]     지금 그리는 1획만 (desynchronized)
[정적 타일]  확정된 획들 → 512px 타일 비트맵 캐시 (OffscreenCanvas + Worker에서 렌더)
[배경]       페이지 템플릿(줄/모눈/코넬) 또는 PDF 페이지 비트맵
```

- **Canvas 2D vs WebGL**: 1차는 Canvas 2D(구현 단순, 텍스트·PDF와 합성 쉬움, 타일 캐시면 충분). 획이 수만 개인 보드에서 팬이 60fps 미만이면 WebGL(삼각분할 메시 + 인스턴싱) 렌더러로 교체할 수 있게 `Renderer` 인터페이스로 분리.
- **줌/팬**: 제스처 중에는 기존 타일을 CSS transform으로만 늘려 보여주고(즉각 반응), 손을 떼면 새 배율로 타일을 다시 그림(굿노트 방식). 배율 단계(0.5/1/2/4×)별 타일 캐시, LRU로 메모리 제한.
- **페이지 vs 무한 캔버스**: 페이지 종류 `ink`(A4·레터·커스텀, 세로 스크롤 연속 페이지)와 `board`(무한 캔버스)를 같은 엔진·같은 좌표계로 처리. 화면 밖 획은 rbush(R-tree) 공간 인덱스로 컬링.
- **지우개**: 1차 = 획 지우개(rbush로 후보 → 선분 거리 판정 → 획 삭제). 2차 = 부분 지우개(교차점에서 획 분할).
- **올가미**: 다각형 안에 점의 과반이 들어간 획 선택 → 이동·크기·색 변경·복제·"카드 만들기"·"링크 만들기".
- **실행 취소**: 명령 패턴(AddStroke/RemoveStrokes/Transform) 스택, 페이지별 200단계.

### 3.5 강의 PDF 위 필기

| 단계 | 구현 |
|---|---|
| 가져오기 | PDF Blob을 Asset 테이블에 저장(큰 파일은 OPFS로), 페이지마다 `pdf` 종류 Page 생성 |
| 렌더 | pdfjs-dist(2026년 6.x 라인, Apache-2.0)를 Worker로 실행, 현재 배율에 맞춰 페이지 비트맵 생성·캐시 |
| 좌표 | 획 좌표를 **PDF 포인트 단위(1/72인치)** 로 저장 → 어떤 배율에서도 정렬 유지 |
| 텍스트 | `getTextContent()`로 텍스트 레이어 추출 → 검색 색인·문장 선택·하이라이트 |
| 내보내기 | pdf-lib로 원본 PDF 위에 획을 벡터 경로로 덧그려 "필기 포함 PDF" 생성 |

### 3.6 손글씨 → 텍스트 인식

| 옵션 | 브라우저 내? | 판단 |
|---|---|---|
| Chrome Handwriting Recognition API | 사실상 ChromeOS 전용, 영어 위주 | 범용 불가 |
| **iPadOS Scribble** | OS 기능, 한국어 지원 목록에 포함 | **1차 채택**: 문서 블록(텍스트 입력 영역)에 펜으로 쓰면 OS가 글자로 변환. 비용 0 |
| Tesseract.js (kor) | 예 (WASM) | 인쇄체 OCR용(스캔 PDF·사진). 손글씨 정확도는 낮음 |
| ONNX 손글씨 모델(transformers.js) | 예, 수십~수백 MB | 한국어 손글씨 모델이 마땅치 않음. 연구 과제 |
| AI 게이트웨이(비전 LLM) | 아니오(서버) | 품질 최고. 10장의 AI 구조로 나중에 선택 기능 |

결론: MVP는 "필기 그대로 저장 + 잉크 앵커 + Scribble + PDF 텍스트 검색". 필기 검색(OCR)은 AI 단계(v2)에서.

---

## 4. 블록 에디터

| 후보 | 현황(2026) | 장점 | 단점 |
|---|---|---|---|
| **TipTap v3 (추천)** | 3.29.x, 활발히 릴리스, 코어 MIT | ProseMirror 기반이라 커스텀 노드·NodeView 자유, Yjs 협업 확장, 생태계 큼 | 노션식 블록 UX(드래그 핸들, 블록 메뉴)는 직접 조립 |
| BlockNote | 0.5x (1.0 이전, 0.52에서 Yjs 분리 등 깨지는 변경) | 노션식 블록 UX가 즉시 완성 | 디자인 자유도 낮음, 일부 고급 패키지는 GPL/상용 이중 라이선스 |
| Lexical | 0.48 (메타, 1.0 이전) | 빠르고 가벼움 | 블록 UX·생태계는 직접 구축 몫이 큼 |

**구현 메모**
- 블록 UX: 각 최상위 노드에 고유 id(UniqueID), 왼쪽 드래그 핸들, `⋮⋮` 블록 메뉴(변환·복제·카드로 만들기). 드래그 핸들 등은 TipTap 확장 사용(설치 전 라이선스 재확인).
- 슬래시 명령: `@tiptap/suggestion` + floating-ui 팝오버. 한글 검색어 지원("/수식", "/표"). **IME 조합 중(`view.composing`)에는 입력 규칙·메뉴 트리거를 막아** 한글 깨짐 방지.
- 수식: KaTeX(인라인 `$…$`, 블록 `$$…$$`), 편집 시 원문·미리보기 토글.
- 코드 블록: CodeBlockLowlight(가벼움). 대안 Shiki는 품질 높지만 무거워 지연 로드.
- 특수 블록: 필기 블록(문서 안에 작은 ink 캔버스 임베드), PDF 페이지 임베드, 토글, 콜아웃, 표, 체크리스트, 이미지.
- **[[위키링크]]·백링크**

```
입력 "[[" → 제목 자동완성(검색 Worker) → wikiLink 인라인 노드 {targetId, alias}
저장(디바운스 800ms) → 문서 JSON 순회 → wikiLink 수집 → Link 테이블 upsert
백링크 패널 = Link.where('targetPageId').equals(현재 페이지) + 해당 블록 문맥
없는 제목 → targetTitle만 저장된 "미해결 링크" → 클릭 시 페이지 생성 후 해결
```

  링크는 id 기반이라 제목을 바꿔도 깨지지 않는다(기획 C1 '이름 변경 시 링크 갱신'은 표시 문자열만 다시 그리면 됨). 블록 참조 `((블록))`는 v1.
- **잉크 앵커(기획 A4·W1, MVP)**: 올가미 → 이름 입력 단순판. 선택 획의 `strokeIds`와 bbox를 InkAnchor로 저장하고 `Link.kind='ink'`로 연결. 손글씨 인식 없이 동작하며, 그래프에 손필기 노드로 함께 뜬다.

- 저장 형식: 페이지 문서 = ProseMirror JSON 1건(빠른 로드). Block 테이블은 검색·카드·블록 참조용 **파생 인덱스**(원본 아님).

---

## 5. 지식 그래프 시각화

| 후보 | 규모 적합 | 판단 |
|---|---|---|
| **sigma.js v3 + graphology (추천, 전체 그래프)** | 수천~수만 노드 (WebGL) | 3.0.x 안정판, v4는 WebGL2·SDF 라벨로 베타 진행 → v3로 시작, v4 이행 가능성 열어둠 |
| **d3-force + Canvas (로컬 그래프)** | ~1천 노드 | 현재 페이지 주변 1~2단계 이웃. 스프링 연출·호버 애니메이션 등 "수상작급" 연출에 유리 |
| three.js 직접 구현(3D 은하) | 수천 | 시각적으로 강렬하지만 비용 큼 → 8장의 WebGL 연출 모드로 선택 제공 |
| cosmos.gl 등 GPU 레이아웃 | 10만+ | 학생 볼트 규모엔 과함 |

성능 설계: 레이아웃(ForceAtlas2)은 **Web Worker**에서 계산하고 좌표를 DB에 캐시 → 다음 진입 시 즉시 표시. 노드 크기 = 링크 수, 색 = 과목. 줌 단계에 따라 라벨 숨김. 2,000노드 시드 데이터로 60fps 팬·줌을 합격 기준으로 둔다. 그래프를 못 보는 사용자를 위해 같은 데이터를 "연결 목록" 뷰로도 제공(접근성).

---

## 6. 데이터 계층

### 6.1 저장소 선택

| 후보 | 장점 | 단점 | 판단 |
|---|---|---|---|
| **Dexie 4.x (IndexedDB) — 추천** | iOS Safari 포함 전 브라우저, Blob 저장, liveQuery 반응형, 스키마 업그레이드 간단, 특수 헤더 불필요 | SQL·조인 없음 | MVP 채택 |
| SQLite WASM 공식판(3.53, OPFS) | 진짜 SQL, FTS5 trigram으로 한국어 부분 검색 | Worker 전용, opfs-sahpool은 다중 탭 동시 접근 불가, wasm 약 1MB, 반응형 쿼리 직접 구현 | Repository 인터페이스로 나중에 교체 가능하게만 |
| PGlite 등 | 강력 | 무거움 | 제외 |

### 6.2 데이터 모델

| 엔티티 | 주요 필드 | 관계 | 메모 |
|---|---|---|---|
| Course 과목 | id, name, color, semester, professor, credits | 1:N Notebook, Assignment, CourseSlot | 대학생 맥락의 최상위 묶음 |
| CourseSlot 시간표 | id, courseId, weekday, start, end, room | N:1 Course | 시간표·"지금 수업" 자동 노트 |
| Notebook | id, courseId?, parentId?, title, cover, order | 1:N Page, 폴더 트리 | |
| Page | id, notebookId, kind(`doc`/`ink`/`pdf`/`board`), title, template, size, docJson?, assetId?, pdfPageIndex?, tags[] | 1:N Stroke, Block, Link(출발) | 모든 콘텐츠의 단위 |
| Block (파생) | id, pageId, type, text, order, headingPath | N:1 Page | 검색·카드·블록 참조용 인덱스 |
| Stroke | id, pageId, layer, tool, color, width, points(ArrayBuffer: x,y,p,t), bbox | N:1 Page | 획 1개 = 행 1개, 점은 이진 압축 |
| InkElement | id, pageId, kind(image/textbox/shape/sticker), transform, data | N:1 Page | 필기 페이지 위 개체 |
| Asset | id, kind(pdf/image/audio), mime, size, hash, blob 또는 opfsPath | 1:N Page | 중복은 hash로 제거 |
| InkAnchor 잉크 앵커 | id, pageId, name, strokeIds[], bbox | N:1 Page, Link 대상 | 손글씨 영역에 이름 붙인 링크 지점 |
| Link | id, sourcePageId, sourceBlockId?, targetPageId?, targetAnchorId?, targetTitle?, kind(wiki/embed/blockref/ink) | Page↔Page·Anchor | 백링크·그래프의 원천 |
| Recording 녹음(v1) | id, pageId, assetId, startedAt, durationMs | N:1 Page | 획의 절대 시각 `t`와 맞춰 필기 되감기(A5·W7) |
| Card | id, sourcePageId, sourceBlockId?, courseId, type(basic/cloze/occlusion), front, back, fsrs{due, stability, difficulty, reps, lapses, state, lastReview}, suspended | N:1 Page | 출처로 바로 이동 가능 |
| ReviewLog | id, cardId, rating, reviewedAt, elapsedMs, 이전 상태 | N:1 Card | 향후 FSRS 파라미터 최적화 재료 |
| Session 집중 | id, kind(focus/short/long), courseId?, assignmentId?, plannedMs, startedAt, endedAt, pausedMs, completed | N:1 Course | 통계의 원천 |
| Assignment | id, courseId, type(과제/시험/퀴즈), title, dueAt, status, priority, linkedPageIds[] | N:1 Course | 시험 범위 = 연결 페이지 |
| Setting | key, value | — | 테마·모션 강도·펜 설정 |
| ChangeLog | ++seq, table, rowId, op, ts | — | 미래 동기화용 아웃박스 |

모든 행에 `createdAt`, `updatedAt`, `deletedAt`(소프트 삭제·휴지통)을 둔다.

```ts
db.version(1).stores({
  courses: 'id, semester, updatedAt',
  notebooks: 'id, courseId, parentId, updatedAt',
  pages: 'id, notebookId, kind, *tags, updatedAt, deletedAt',
  blocks: 'id, pageId, type',
  strokes: 'id, pageId, [pageId+layer], updatedAt',
  assets: 'id, hash',
  inkAnchors: 'id, pageId, name',
  links: 'id, sourcePageId, targetPageId, targetAnchorId, targetTitle',
  cards: 'id, sourcePageId, courseId, fsrs.due, fsrs.state',
  reviewLogs: 'id, cardId, reviewedAt',
  sessions: 'id, startedAt, courseId',
  assignments: 'id, courseId, dueAt, status',
  changeLog: '++seq, table, rowId, ts',
});
```

### 6.3 전문 검색

| 후보 | 판단 |
|---|---|
| **FlexSearch 0.8 (추천)** | CJK 문자셋 공식 지원, 벤치마크상 가장 빠름, Worker·IndexedDB 영속 색인 지원 |
| MiniSearch | API 단순, 색인 JSON 직렬화 쉬움. 한국어는 커스텀 토크나이저 필요 |
| Orama | 기능 많지만 한국어 분절 근거 부족 |

**한국어 핵심 문제**: "미적분학은"에서 "미적분"을 찾아야 한다(조사가 붙음). → 공백 분리 + **한글 2-gram** 토큰을 함께 색인하고, 질의도 같은 방식으로 쪼갠다. 색인 대상: 페이지 제목, 문서 텍스트(Block), PDF 텍스트 레이어, 카드 앞뒤, (나중) 필기 OCR 텍스트. 색인은 Worker에서 증분 갱신. 명령 팔레트(Ctrl/⌘+K)에서 결과를 종류별로 묶어 보여줌.

### 6.4 백업 · 내보내기

| 형식 | 내용 | 도구 |
|---|---|---|
| 전체 백업 `.studyos` | 모든 테이블 JSON + Asset Blob을 ZIP | fflate 또는 client-zip, 가져오기로 복원 |
| Markdown 볼트 | 문서 → `.md`(frontmatter, `[[링크]]` 유지), 필기 → SVG 임베드 → **옵시디언에서 바로 열림** | TipTap Markdown 직렬화 |
| PDF | 필기 포함 PDF(pdf-lib), 문서 페이지는 인쇄 CSS → "PDF로 저장" | pdf-lib, `window.print()` |
| Anki `.apkg` (v1, 조사 D6) | 카드·복습 기록을 안키로 내보내기 (apkg = SQLite 파일을 압축한 형식) | sql.js(WASM)를 이 기능에서만 지연 로드 |
| 폴더 자동 백업(데스크톱 Chromium) | File System Access API로 사용자가 고른 폴더에 주기 저장 | 선택 기능 |

**데이터 유실 대비**: 시작 시 `navigator.storage.persist()` 요청, 용량 `estimate()` 표시. iOS Safari는 홈 화면 설치 여부에 따라 비활성 데이터 삭제 정책이 달라질 수 있으므로 "홈 화면에 추가" 안내 + 주 1회 백업 알림.

### 6.5 미래 동기화를 위한 여지 (CRDT)

| 데이터 | 동기화 방식(나중) | 지금 해 둘 일 |
|---|---|---|
| 문서 본문 | **Yjs** Y.Doc (TipTap Collaboration 확장이 그대로 연결) | 문서 저장을 `DocStore` 인터페이스 뒤로. 나중에 PM JSON → Y.Doc 업데이트 바이너리로 교체 |
| 획 | Y.Map(strokeId → 획) 또는 행 단위 LWW | 획은 불변(수정 = 삭제 + 추가)으로 설계 → 충돌이 거의 없음 |
| 메타데이터·카드·세션 | 행 단위 최종 기록 우선(LWW) + updatedAt | ULID, 소프트 삭제, ChangeLog 아웃박스 |
| 서버 후보 | Hocuspocus / y-websocket / Cloudflare Durable Objects | — |

y-indexeddb는 npm 마지막 배포가 오래됐다(9.0.x). 동기화 단계에서는 Yjs 업데이트를 Dexie에 직접 저장하는 자체 어댑터를 권장. 대안: Automerge, Dexie Cloud(유료), PowerSync 등 행 동기화 서비스.

---

## 7. 학습 기능 로직

### 7.1 간격 반복 (FSRS)

| 항목 | 추천 | 대안 | 이유 |
|---|---|---|---|
| 알고리즘 | **ts-fsrs 5.x** (안정 5.4.1, 2026-05 · FSRS-6 구현). 6.0은 베타(2026-08)라 안정판 나오면 이행 | SM-2(구 안키), 라이트너 상자 | 같은 기억률에서 복습 횟수가 적은 최신 알고리즘, TS 네이티브 |
| 목표 기억률 | 기본 0.90, 설정 0.80~0.95 | — | 학생이 "공부량 vs 기억률"을 직접 조절 |
| 파라미터 최적화 | 복습 1,000회 이상 쌓이면 ReviewLog로 개인화(브라우저 WASM 옵티마이저, v1) | 기본 파라미터 고정 | 초기엔 기본값으로 충분 |

- 카드 생성: 링크 인덱서가 문서를 훑을 때 `질문 :: 답`, `{{빈칸}}`도 함께 파싱 → Card를 **blockId 기준 upsert**. 블록을 고쳐도 복습 일정은 유지되고 내용만 바뀜.
- 시험 모드(D5, v1): 시험일 이후로 잡힌 범위 카드의 간격을 시험일 이전으로 잘라 넣고, 하루 목표 = 남은 범위 카드 ÷ 남은 일수.
- 테스트 가능성: 모든 일정 계산이 주입 가능한 `clock.now()`를 사용 → 가짜 시계로 30일 복습을 몇 초 만에 검증.

### 7.2 뽀모도로 타이머 정확도

```ts
type Timer = { phase: 'focus'|'short'|'long'; startedAt: number; plannedMs: number;
               pausedAt?: number; pausedTotalMs: number };
remaining = plannedMs - (Date.now() - startedAt - pausedTotalMs);   // 틱을 세지 않는다
```

| 문제 | 대응 |
|---|---|
| 백그라운드 탭에서 메인 스레드 타이머가 늦춰짐(크롬은 오래 숨겨진 탭의 연쇄 타이머를 분 단위까지 늦춤) | 시간은 **항상 시각 차로 계산**. 숨겨진 동안 종료 감지는 Dedicated Worker의 1초 틱이 맡음 |
| 화면 표시 | 보일 때는 rAF로 원형 진행 링을 매끄럽게, `visibilitychange` 복귀 즉시 재계산 |
| 종료 알림 | Web Audio 종소리(시작 버튼 탭 때 오디오 잠금 해제) + `registration.showNotification()`. 권한은 첫 타이머 시작 때만 요청 |
| iOS 한계 | 알림은 홈 화면에 설치한 웹앱만 가능하고, 잠금·백그라운드에선 JS가 멈춰 정시 알림을 보장할 수 없다(웹엔 예약 로컬 알림이 없음). → 집중 화면은 Screen Wake Lock으로 화면 켜둠, 복귀 시 "09:41에 끝났어요"로 기록 보정. **기록 정확도(±1초)는 보장, 정시 알림은 '가능한 기기에서'** 로 완료 기준 10을 해석해야 함 |
| 새로고침·크래시 | 타이머 상태를 매 변경 시 IndexedDB에 저장 → 다시 열면 이어서 진행 |
| 여러 탭 | Web Locks API로 리더 탭 1개만 종료 처리, 나머지는 BroadcastChannel로 화면만 동기화 |
| 탭 이탈 기록(E2, v1) | `visibilitychange`를 Session.interruptions에 누적 |
| 앰비언트(E3) | Web Audio로 백색·갈색 소음을 **실시간 생성**(파일 0개). v1 빗소리 등은 서비스워커 캐시 |

### 7.3 학습 통계

- 원천: Session · ReviewLog · Card · Assignment. 집계: 일별 집중 시간(잔디), 과목별 시간, 연속 일수, 실제 기억률 vs 목표, 30일 복습 예측, 과제 완료율, "시간 × 기억률" 교차표(조사 D4).
- 하루 경계: 기본 새벽 4시(밤샘 공부가 다음 날로 넘어가지 않게), 시간대 Asia/Seoul 기본.
- 계산: Dexie 인덱스 범위 쿼리 → Worker에서 집계, 일별 롤업 캐시(DailyStat, 파생 테이블)로 홈 화면 즉시 표시.
- 차트: **d3-scale/d3-shape + 직접 SVG**(디자인 통제, 작음). 대안: Recharts(무거움), uPlot(시계열 특화).

---

## 8. 모션 · 그래픽 스택

| 도구 (현황) | 쓰는 곳 | 쓰지 않는 곳 |
|---|---|---|
| **Motion 12.x** (`motion/react`) | 컴포넌트 등장·퇴장, 레이아웃 애니메이션(W4 문장→카드 FLIP), 패널·시트·제스처 | 스크롤 서사 |
| **GSAP 3.13+** (2025-04부터 SplitText·ScrollTrigger·MorphSVG 포함 전부 무료, 상업 이용 가능) | 랜딩·온보딩 스크롤 서사, W1·W3 다단계 타임라인, 키네틱 타이포 | 일반 UI 상태 전환(Motion과 중복 금지) |
| **View Transitions API** (같은 문서 전환: Chrome·Safari 18+·Firefox 144+) | 화면 전환(노트북 카드 → 페이지 확장), 테마 전환 원형 리빌 | 미지원 시 즉시 전환(기능 탐지) |
| **CSS 스크롤 연동 애니메이션** | 랜딩의 가벼운 패럴랙스(JS 0) | 미지원 브라우저는 정적(점진적 향상) |
| **Lenis 1.3.x** | 랜딩 페이지만 | **앱 내부 금지**(에디터·캔버스·중첩 스크롤·접근성 충돌) |
| **three.js r18x + R3F v9** (React 19 짝) | 랜딩 히어로, 온보딩 "공부하면 자라는 작은 세계", 3D 별자리 모드(선택) | 편집 화면. 항상 지연 로드 |
| **직접 작성한 WebGL 셰이더(수 KB)** | W2 '나의 결' 배경, 집중 모드 숨 쉬는 배경 | 작은 효과에 three.js를 들이지 않음 |
| OGL | 채택 안 함 | 2025-04 이후 활동 정체 |

**규칙** (기획 §5 원칙 반영): 필기·타이핑 중엔 모션 0. WebGL 루프는 화면 밖·탭 숨김·편집 포커스 시 정지, 셰이더 DPR 최대 1.5. 애니메이션은 `transform`·`opacity` 중심.

### 8.1 성능 예산

| 지표 | 목표 | 측정 |
|---|---|---|
| LCP (오늘 화면, 캐시 후) | ≤ 1.5초 (중급 안드로이드), 첫 방문 ≤ 2.5초 | Lighthouse(모바일 스로틀), web-vitals 로깅 |
| INP | ≤ 150ms (p75), 목표 100ms | web-vitals |
| CLS | ≤ 0.05 | Lighthouse |
| 초기 JS (셸) | ≤ 170KB gzip | 번들 분석 리포트, size-limit |
| 지연 청크 | 에디터 ≤ 180KB · 필기 ≤ 60KB · 그래프 ≤ 120KB · pdf.js는 PDF 열 때만 · three.js는 3D 장면에서만 | 라우트별 리포트 |
| 필기 | 펜 → 화면 1프레임 이내, 2,000획 페이지 프레임 드랍 < 5% | 자체 지연 오버레이, Performance 트레이스 |
| 메모리 | 타일 캐시 상한 256MB(iPad) | LRU 카운터 |

### 8.2 동작 줄이기 · 접근성

- `prefers-reduced-motion: reduce` → Motion `MotionConfig reducedMotion="user"`, `gsap.matchMedia()` 분기, Lenis 끔, WebGL은 정지 프레임 1장, View Transitions는 짧은 크로스페이드 또는 없음.
- 앱 설정 "모션: 풍부 / 절제 / 끔"이 OS 설정보다 우선. 프레임 시간이 계속 20ms를 넘으면 자동으로 한 단계 낮춤.
- WCAG 2.2 AA: 본문 대비 4.5:1, 포커스 링, 전 기능 키보드, 타이머는 ARIA live로 "분 단위"만 낭독, 그래프는 "연결 목록" 대체 뷰, 필기 페이지는 접근 가능한 이름(제목·앵커 목록) 제공. 자동 점검은 axe-core.

---

## 9. 반응형 전략

기획 §6과 같은 구간을 쓴다: **폰 < 600px · 태블릿 600–1199px · 데스크톱 ≥ 1200px**.

| | 폰 | 태블릿 + 펜 | 데스크톱 |
|---|---|---|---|
| 주 역할 | 복습·타이머·빠른 메모·일정 | 필기·PDF·복습 | 정리·연결·그래프·대시보드 |
| 셸 | 하단 탭 5개 + 바텀 시트 | 아이콘 레일, 편집 시 자동 숨김, 떠 있는 펜 툴바(좌/우손잡이 위치) | 3단 + 탭·분할(최대 3) |
| 입력 | 손가락(엄지 영역에 주요 버튼) | 펜=그리기, 손가락=이동·줌, 하드웨어 키보드 단축키 | 키보드 우선, 링크 호버 미리보기 |
| 필기 | 보기 + 간단 손가락 필기 | 전체 기능 | 마우스·펜 태블릿 지원 |

| 기법 | 내용 |
|---|---|
| 셸 vs 부품 | 셸 배치는 뷰포트 미디어 쿼리, 카드·패널 내부는 **컨테이너 쿼리**(`@container`) → iPad Split View·Stage Manager·사이드바 폭 변화에 자동 대응 |
| 입력 감지 | `@media (pointer: coarse)`, `(hover: hover)`, `any-pointer` + 런타임 펜 감지(첫 `pointerType==='pen'` → 펜 모드). UA 판별은 하지 않음 |
| 터치 타깃 | coarse 포인터 44×44px 이상, fine 포인터 32px, 어떤 경우도 WCAG 2.5.8 최소 24px |
| 화면 가장자리 | `env(safe-area-inset-*)`, `100dvh`, 가상 키보드는 VisualViewport API로 툴바 위치 보정 |
| 펜 버튼 | S펜 측면 버튼(`buttons` 비트) → 지우개 임시 전환(지원 기기) |
| 회전·분할 | 편집 상태(카메라·선택·커서)를 Zustand에 두어 레이아웃이 바뀌어도 유지(완료 기준 13) |

---

## 10. AI 기능을 나중에 붙이는 안전한 구조

```
브라우저(앱)  ──HTTPS──►  AI 게이트웨이 (Cloudflare Workers 등 서버리스)  ──►  LLM 제공사
 · 키 없음                  · 키: 환경변수 AI_PROVIDER_API_KEY (호스트 비밀 저장소)   · 제공사 콘솔의 월 지출 한도
 · AiClient 인터페이스       · CORS = 앱 도메인만, 기기 토큰(→나중 로그인) 인증
 · 기능 기본 '꺼짐'          · 사용자별 일/월 한도, 요청 크기·max_tokens 상한, 모델 허용 목록
                            · 사용량 카운터(KV/D1), 본문 로그 저장 안 함
```

| 원칙 | 구현 |
|---|---|
| 키는 브라우저에 절대 두지 않음 | Vite는 `VITE_` 접두사 환경변수를 클라이언트 번들에 넣는다 → 비밀 이름은 절대 `VITE_`로 시작하지 않게 하고, 빌드 후 번들에서 키 패턴을 찾는 검사 스크립트를 CI에 둔다 |
| "본인 키" 요구(기획 결정 4-②) | 브라우저 저장 방식은 배제. 대신 **셀프 호스트 게이트웨이**: 사용자가 템플릿을 자기 계정에 배포하고 자기 키를 그 환경변수에 넣음 → 비용을 본인이 완전 통제 |
| 사용자 비용 통제 | 기능별 켜기, 실행 전 예상 토큰·비용 범위 표시, 월 사용량 막대 + 사용자가 정한 상한(게이트웨이가 강제), "선택한 부분만 보내기", 전송 내용 미리보기, 같은 입력(내용 해시)은 로컬 캐시로 재호출 방지 |
| 프롬프트 주입·안전 | 노트 내용은 데이터로만 전달. AI 출력은 명령으로 실행하지 않고, DB에 쓰기 전 사용자 확인(예: 생성 카드는 "검토함"에 먼저) |
| 개발 중 | `MockAiClient`로 비용 0 개발·테스트. 실제 게이트웨이는 배포·키 설정이 필요하므로 사용자 승인 후 |

```ts
interface AiClient {
  isEnabled(): boolean;
  estimate(task: AiTask): Promise<{ inputTokens: number; maxOutputTokens: number }>;
  run(task: AiTask, opts: { signal: AbortSignal }): AsyncIterable<AiChunk>;
}
type AiTask = { kind: 'summarize'|'cards'|'explain'|'ocr'; pageId: string; selection?: string; image?: Blob };
// 동기화도 같은 방식의 경계: SyncAdapter { push(changes), pull(since), subscribe(cb) }
```

---

## 11. 빌드 로드맵 (Claude Code 세션 기준)

**검증 환경**: Claude Code는 Vite 개발 서버를 띄워 내장 브라우저로 클릭·입력·스크린샷, 뷰포트 변경(360/768/1024/1440), 콘솔·네트워크 확인, 합성 펜 이벤트(`new PointerEvent('pointermove',{pointerType:'pen', pressure})`) 주입까지 할 수 있다. **할 수 없는 것**: 실제 애플펜슬·S펜의 지연감·팜 리젝션, iOS 홈 화면 알림, 실기기 한글 IME 조합 → 마일스톤마다 사용자 실기기 체크리스트를 둔다. iPad 테스트는 같은 와이파이에서 `vite --host` + 자체 서명 HTTPS(`getCoalescedEvents` 등이 보안 컨텍스트 전용이라 필요).

| # | 마일스톤 | 산출물 | 검증 (브라우저에서 실제 실행) |
|---|---|---|---|
| M0 | 기반 셸 | Vite·라우팅·디자인 토큰(테마 3종)·반응형 셸 3종·Dexie 스키마·PWA·샘플 과목 시드·⌘K 뼈대 | 360/768/1440 스크린샷에서 내비 전환·가로 스크롤 0, 오프라인 새로고침 동작, 새로고침 후 데이터 유지 |
| M1 | 필기 엔진 | 펜·형광펜·지우개·올가미·줌/팬·실행취소·템플릿·자동 저장, 문서 안 필기 블록, 잉크 앵커 | 압력 사인파 합성 획 → 굵기 변화 확인, 2,000획 페이지 팬 시 rAF 카운터 55fps+, 펜 모드에서 합성 touch 이벤트가 획을 만들지 않음, **사용자 iPad 1차 체감 테스트(가장 먼저)** |
| M2 | 에디터·링크·검색 | TipTap 블록 12종·슬래시·KaTeX·코드·템플릿 4종·`[[링크]]`·백링크·태그·FlexSearch·마크다운 내보내기 | `[[` 자동완성 → 링크 생성 → 백링크 표시, 이름 변경 후 링크 유지, "미적분" 검색이 "미적분학은" 적중, 1만 블록 시드 검색 100ms 이내, 내보낸 .md 내용 확인. 한글 IME는 사용자 체크 |
| M3 | PDF·그래프 | PDF 가져오기·필기·합본 내보내기, 전역/로컬 그래프·필터, W1 연출 | 로컬에서 만든 100쪽 테스트 PDF로 첫 페이지 3초 이내, 50%/200% 줌에서 획 정렬 스크린샷 비교, 1,000노드·5,000링크 시드 2초 내 표시·fps 측정 |
| M4 | 복습·집중·계획 | 카드 문법·FSRS 큐·휴식 3장·뽀모도로/스톱워치(Worker)·알림·앰비언트·오늘 화면·시간표·D-day·잔디 | 가짜 시계로 30일 복습 시뮬레이션(간격 증가 확인), 숨김 탭 상태로 2분 압축 타이머 종료 시각 오차 < 1초, 시드 세션 대비 통계 수치 일치 |
| M5 | 모션·완성도 | 나의 결 셰이더, W2~W6 시그니처, View Transitions, 랜딩·온보딩(GSAP), 동작 줄이기, 백업/복원 zip | reduced-motion 에뮬레이션 시 연출 0, axe 심각 위반 0, Lighthouse 성능·접근성 90+, 번들 예산 통과, 백업 → DB 초기화 → 복원 후 행 수·내용 일치 |

M6(선택): `MockAiClient`·게이트웨이 템플릿 코드·`SyncAdapter` 스텁까지만(배포·키 설정은 사용자 승인 후).

### 기술 리스크 Top 5

| # | 리스크 | 영향 | 대응 |
|---|---|---|---|
| 1 | **iPad Safari 펜 입력 품질** — 펜 이벤트 샘플링이 성기다는 보고, 예측 이벤트 부재, 가장자리 스와이프·길게 누르기 돋보기 등 제스처 충돌 | 최상 | M1 첫 주에 지연 측정 시제품 → 사용자 실기기 확인. 입력 어댑터 분리로 Touch Events 경로 대체 가능, 자체 예측 보정, `Renderer` 분리로 WebGL 교체 가능 |
| 2 | **로컬 데이터 유실** — 저장소 삭제 정책, 사용자의 사이트 데이터 삭제, 스키마 마이그레이션 버그, 용량 초과 | 최상 | `persist()` 요청, 홈 화면 설치 유도, 7일 백업 알림, 데스크톱 폴더 자동 백업, 고정 픽스처 DB로 마이그레이션 테스트, 30일 휴지통 |
| 3 | **한국어 IME·검색** — 입력 규칙·슬래시·`[[` 자동완성이 조합 중 끼어들어 글자 깨짐, 조사 때문에 검색 누락 | 상 | `composing` 가드, 플랫폼별 한글 테스트 문장 세트(완료 기준 6), 2-gram 색인 |
| 4 | **수상작급 모션 vs 성능** — WebGL과 필기 캔버스의 GPU 경쟁, 번들 비대, 중급 안드로이드 발열 | 상 | 지연 로드·편집 중 WebGL 정지·모션 3단계·번들 예산 CI |
| 5 | **범위와 라이브러리 변동** — 기능 39개, 0.x 라이브러리(sigma v4, BlockNote), pdf.js 5→6 메이저 변경 | 중상 | 마일스톤별 수직 완성, 기능 플래그, 버전 고정, 어댑터 경계(`Renderer`·`DocStore`·Repository·`AiClient`·`SyncAdapter`) |

---

## 12. 기획서·조사 보고서 반영 메모

| 출처 | 항목 | 기술 대응 |
|---|---|---|
| plan A4·W1 | 잉크 링크 MVP | 4장 InkAnchor, MVP는 "올가미 → 이름" 단순판 (기획 결정 5에 대한 설계 측 답: **MVP 가능**) |
| plan A5·W7 | 녹음–필기 싱크(v1) | MediaRecorder로 녹음 Asset 저장, 획 점에 절대 시각 `t` 저장 → 재생 시각으로 획 재생. 저장 형식은 M1부터 `t` 포함 |
| plan B6 | 데이터베이스 뷰(v1) | Page에 `props` 필드(날짜·상태·태그) + Dexie 쿼리 → 표·보드·캘린더 |
| plan C4 | 캔버스 보드(v1) | 같은 필기 엔진의 `board` 페이지 + 노트 카드 노드·화살표 |
| plan D4 | 가리기 카드(v1) | 올가미/사각 영역을 Card(type=occlusion)에 bbox로 저장, 렌더 시 마스크 |
| plan F2·조사 D7 | 시간표·`.ics`·붙여넣기 | 주간 그리드 = CourseSlot. ical.js로 `.ics` 파싱(v1), 붙여넣기 텍스트는 규칙 파서 |
| plan F5 | 학점 계산기 | 순수 함수 + 단위 테스트 (4.5/4.3 만점) |
| plan G2·W2 | 나의 결 | DailyStat을 시드로 쓰는 결정적(deterministic) 셰이더 → 같은 데이터 = 같은 무늬, v1 포스터는 캔버스 → PNG |
| plan H1·W6 | "물리 25분" | AI 없이 규칙 파서: 과목명 퍼지 매칭 + `(\d+)\s*분` → 노트 열기 + 타이머 시작. 팔레트 UI는 cmdk |
| plan 완료 기준 10 | 화면 꺼짐 후에도 ±1초 | 기록 정확도는 보장, iOS 정시 알림은 플랫폼 한계(7.2) → 리더 조율 필요 |
| 조사 3-2·D8 | 3D는 한 장면에 집중, 앱 본체는 빠르게 | 8장 도구 배치와 일치(랜딩·온보딩·집중 모드에만 WebGL) |
| 조사 D6 | `.apkg` 내보내기 | 6.4 표(v1) |

---

## 출처 (2026-10 확인)

- TipTap v3: https://tiptap.dev/docs/resources/whats-new · 릴리스 추적 https://releasealert.dev/github/ueberdosis/tiptap
- BlockNote 0.52 릴리스: https://newreleases.io/project/github/TypeCellOS/BlockNote/release/v0.52.0
- Lexical 릴리스 미러: https://swiftpackageregistry.com/facebook/lexical
- sigma.js v4 베타 문서: https://v4.sigmajs.org/ · npm https://npmjs.com/package/sigma
- Dexie 릴리스: https://github.com/dexie/Dexie.js/releases · SQLite WASM 소식: https://sqlite.org/wasm/doc/tip/news.md
- ts-fsrs: https://npmjs.com/package/ts-fsrs · 버전 이력 https://security.snyk.io/package/npm/ts-fsrs/versions
- GSAP 무료화: https://webflow.com/blog/gsap-becomes-free · Motion 변경 기록: https://motion.dev/changelog?lib=motion
- getCoalescedEvents(MDN): https://developer.mozilla.org/docs/Web/API/PointerEvent/getCoalescedEvents · getPredictedEvents(MDN): https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents
- iPad 펜 포인터 이벤트 보고: https://developer.apple.com/forums/thread/776468
- Handwriting Recognition API: https://developer.chrome.com/docs/web-platform/handwriting-recognition · Scribble: https://support.apple.com/guide/ipad/aside/ipad355ab2a7/ipados
- tldraw 라이선스: https://tldraw.dev/legal/tldraw-license
- Vite 8: https://vite.dev/blog/announcing-vite8 · vite-plugin-pwa 1.3.0: https://newreleases.io/project/npm/vite-plugin-pwa/release/1.3.0
- View Transitions Baseline: https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available · caniuse https://caniuse.com/cross-document-view-transitions
- Safari 저장소 정책 논의: https://developer.apple.com/forums/thread/710157
- pdf.js: https://en.wikipedia.org/wiki/PDF.js · FlexSearch: https://github.com/nextapps-de/flexsearch
- R3F v9 이행 가이드: https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide · three.js: https://en.wikipedia.org/wiki/Three.js · OGL: https://github.com/oframe/ogl
- y-indexeddb: https://www.npmjs.com/package/y-indexeddb
