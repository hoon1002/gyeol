# 결 v4 조사 보고서 (research-v4.md)

작성: 조사원(research) · 2026-10-17 · 웹 검색·페이지 확인 24회
범위: ① 3D·우주 웹 명작 ② 실제 은하의 3D 구조·색·회전 ③ '못 끊는' 학습·생산성 앱 ④ 학습 과학 ⑤ 바로 쓸 시사점
표기: **(확인)** = 이번 조사에서 공식 페이지·수상 목록으로 확인 · **(미확인)** = 확인 못 함 · **(추론)** = 조사원 해석 · **(문헌)** = 학술 문헌 기억 기반(DOI 제공, 이번 세션 웹 재확인은 일부만) · `[R#]` 웹 출처 · `[L#]` 학술 출처 · `[이전 S#]` = `team/research.md` 출처

---

## 1. 3D·우주 웹 경험 12선

### 1-1. 작품표

| # | 작품 · 제작 · 연도 · URL | 수상 | 입체감·생동감의 원천 | 가져올 기법 | 피할 것 |
|---|---|---|---|---|---|
| 1 | **100,000 Stars** · Google Data Arts Team · 2012 · experiments.withgoogle.com/100000-stars | 공식 제작기에 수상 언급 없음 [R1]. design-v3의 'D&AD Graphite Pencil'은 **(미확인)** | 실제 HYG 목록의 별 119,617개를 입자 하나씩 그리고 색지수를 색 램프로 칠함. 턴테이블처럼 도는 장면, 줌에 따라 FOV를 넓히고 좁힘, 틸트시프트 같은 피사계 심도 흐림으로 규모감. 은하는 입자 10만 개 나선팔에 NGC 1232 사진을 섞어 사진 같은 결을 냄 [R1] | 색지수 → 색 램프, **입자 + 저해상 사진 질감 혼합**, 줌할 때 FOV 보정, 라벨은 DOM(CSS3D) 오버레이 | '1 GL 단위 = 1광년' 같은 큰 좌표(부동소수 떨림이 생김), 렌즈 플레어 |
| 2 | **NASA's Eyes on the Solar System** (+Exoplanets·Asteroids) · NASA/JPL · 2010~ · eyes.nasa.gov | Eyes 계열 수상: Eyes on the Earth(Webby 2009, 2017 데이터 시각화), Experience Curiosity(WebGL, Webby 2016), Eyes on Asteroids(People's Voice) **(확인)** [R11][R12]. Solar System 앱 자체 수상은 **(미확인)** | 실제 궤도 데이터. 대상을 고르면 그 주위를 도는 궤도 카메라, **시간 배속 슬라이더**로 사용자가 공전 속도를 정함, 얇은 궤도선이 깊이 단서 | 시간 배속 → **'자전 속도' 설정**(멈춤·느림·보통), 대상 중심 궤도 카메라, 얇은 궤도선 | 실제 축척(화면이 텅 빔), 정보 패널 과다 |
| 3 | **Bruno Simon Portfolio** · 2019 / 2025~26 재구축 · bruno-simon.com | Awwwards Sites of the Year 2019 목록 **(확인)** [R3]. 새 버전 SOTM 2026.1은 [이전 S23] 기준이며 이번엔 재확인 못 함 | 직접 모는 차, 물리 충돌, 차를 부드럽게 뒤따르는 고정 각도 카메라, 장난감 같은 구운 조명·그림자. 새 버전은 WebGPU + TSL 셰이더 [R6][R7] | 카메라 **감쇠 추적(lerp)**, 접촉 그림자 같은 기준면, WebGPU 우선 + WebGL2 폴백 | 게임형 조작(학습 앱엔 과함) |
| 4 | **Igloo Inc** · abeto × Bureaux · 2024 · igloo.inc | Awwwards **Site of the Year 2024** **(확인)** [R3] | 얼음 결정 3D, 끊김 없이 이어지는 섹션 전환. 볼륨 데이터 내보내기 도구, 대형 유체 시뮬, 셰이더 컴파일 전략으로 로딩 단축 [R4] | 성운·먼지를 **미리 구운 볼륨(3D 텍스처)**으로, **셰이더 사전 컴파일**로 첫 프레임 끊김 제거, 작은 모노 캡션 | 스크롤에 끌려 날아가는 카메라 |
| 5 | **Lusion v3** · Lusion · 2023 · lusion.co | Awwwards **Site of the Year 2023** **(확인)** [R3]. 스튜디오 사이트 D&AD Wood Pencil [R10] | 물리 기반 실시간 조명, 부드러운 빛 번짐, 입자 하나하나의 질감 | 절제된 블룸(작은 반경·높은 임계값), 입자 = 가우시안 코어 + 옅은 헤일로 | 포인터를 따라 장면이 휘는 연출 |
| 6 | **Messenger** · abeto · 2025 · messenger.abeto.co | Awwwards **Site of the Year 2025** **(확인)** [R3] | 작은 행성의 둥근 지평선 덕에 입체가 바로 읽힘. 같은 행성 위 다른 사람들의 기척. Three.js + three-mesh-bvh, Houdini·Blender 에셋 [R5] | 작은 세계의 곡률처럼 **원반의 기울기**로 입체를 즉시 읽게 함. '다른 존재'의 은은한 신호 | 캐릭터 조작, 멀티플레이 운영 부담 |
| 7 | **Star Atlas** · Hello Monday/DEPT · 2021 · staratlas.com | Awwwards SOTY 2021 Users' Choice, Webby People's Voice(Entertainment) **(확인)** [R8] | 우주선·행성을 **점 구름**으로 그려 별처럼 보이게 함. 자체 점 구름 셰이더와 **가짜로 움직이는 피사계 심도**로 빠르게, Draco 압축 [R8] | 우리 은하에 가장 직접 쓸 수 있음: 점 크기·투명도를 초점 거리 차로 조절하는 **가짜 DOF**(후처리 없음) | 포털로 빨려 드는 줌 인 |
| 8 | **Active Theory v4 / Prometheus Fuels** · Active Theory · 2018 / 2021 · activetheory.net | Awwwards Sites of the Year 2018(v4)·2021(Prometheus Fuels) 목록, v4 SOTM 2018.1 **(확인)** [R3][R9] | 실시간으로 바뀌는 환경 장면, 자체 엔진, 장면마다 다른 조명·안개 | 공간 이동을 카메라 비행 대신 **조명·안개 색 크로스페이드**로 | 무거운 다층 후처리 |
| 9 | **Gaia 'The best Milky Way map'** · ESA/Gaia/DPAC, Stefan Payne-Wardenaar · 2025.1 · esa.int/ESA_Multimedia/Images/2025/01 | 과학 시각화(수상 해당 없음) | 별 약 20억 개 관측으로 갱신한 모델. 팔이 2개보다 많고 더 희미하며, 중심 막대가 태양 쪽으로 더 기울어짐 [R13] | 우리 은하 모양의 **정답지**(막대 + 여러 팔 + 지류). CC BY-SA 3.0 IGO라 참고만, 쓰면 출처 표기 | 원본 이미지 복사 |
| 10 | **Stellarium Web / Solar System Scope** · Stellarium Labs / INOVE · stellarium-web.org, solarsystemscope.com | **(미확인)** | 지평선·대기·시간 흐름이 있는 실제 하늘(전자). 아주 먼 은하수 스카이박스 위에서 행성을 궤도 카메라로 보기(후자) | **고정 기준면**(지평선·스카이박스)이 회전을 편하게 만든다는 점. 가장 먼 층은 거의 움직이지 않게 | 관성이 큰 빠른 드래그 회전 |
| 11 | **Three.js Journey 'Galaxy Generator'·'Animated Galaxy'** · Bruno Simon · threejs-journey.com | 교육 강좌(수상 해당 없음) | 팔 개수, 반지름에 비례해 감기는 각, 거듭제곱 무작위로 팔 중심에 별이 몰리게, 안→밖 색 보간, 가산 혼합. 후속 강의는 버텍스 셰이더에서 거리의 역수에 비례한 각으로 돌려 **안쪽이 빠른 회전**을 만듦 [R15] | 은하 생성 매개변수 체계의 출발점 | 그대로 쓰면 '튜토리얼 은하' 티가 남(먼지·HII·막대 없음) |
| 12 | **GPGPU 은하 입자** (커뮤니티 시연) · three.js forum · 2025~26 | 해당 없음 | GPU에서 약 200만 입자를 움직임 [R16] | 데스크톱 상위 등급 입자 수의 기준 | 모바일에 그대로 적용 |

> 막힌 점: Active Theory·Lusion의 **우주 주제** 단독 수상작은 찾지 못함. FWA 수상 이력은 이번에도 확정하지 못함.

### 1-2. 입체감 기법 사전 (모션 개발자용)

| 기법 | 깊이를 만드는 원리 | 제안 값 (추론) | GPU 비용 | 멀미 위험 |
|---|---|---|---|---|
| **운동 시차 층** | 가까운 것이 더 많이 움직임. 회전이 느려도 층 간 상대 운동으로 3D가 읽힘 | 4층: ① 먼 배경 별(스카이박스, 사실상 고정) ② 헤일로·구상성단 ③ 원반(별·팔·먼지) ④ 앞쪽 가까운 별 몇 개·옅은 먼지 | 낮음 | 낮음(느리면) |
| **3/4 시점** | 정면은 평면 그림, 옆면은 팔이 사라짐 | 원반 면 위 25~35°(기울기 55~65°) | 0 | 0 |
| **차등 회전** | 안쪽이 빨리 돌아 살아 있는 소용돌이로 보임 (2-3절) | 안/밖 각속도 비 3~5배 | 셰이더 1식 | 낮음 |
| **가짜 피사계 심도** | 점 크기 ∝ \|깊이 − 초점\|, 알파는 반비례 (Star Atlas) | 초점 = 현재 공간(앱 화면)의 별 | 낮음 | 0 |
| **볼류메트릭 성운·먼지** | 부피가 있는 빛과 그림자 | 빌보드 노이즈(폰) → 미리 구운 3D 텍스처(iPad) → 레이마칭(데스크톱만). **먼지띠는 '흡수'(곱하기)로** 그려야 사진처럼 보임 | 중~높음 | 0 |
| **HDR + 톤매핑** | 가산 혼합이 팽대부를 하얗게 태우지 않게 | 부동소수 렌더 타깃 + AgX 또는 ACES | 중 | 0 |
| **크기 감쇠·밝기 요동** | 원근에 따른 별 크기, 밝은 별만 아주 느린 밝기 요동 | 요동 주기 4~12초, 폭 ±10% | 낮음 | 0 |
| **카메라 궤도·숨** | 시점이 아주 조금 움직이면 시차가 생김 | 궤도 1회전 10분 이상, 또는 ±3° 이내의 느린 흔들림 | 0 | 속도에 비례 |
| **입자 수 등급** | 밀도 = 사실감 | 폰 8만~15만 / iPad 15만~30만 / 데스크톱 50만~200만 | — | — |

### 1-3. 피할 것: 멀미·성능

| 위험 | 근거 | 결의 규칙 (추론) |
|---|---|---|
| 회전과 이동을 동시에 | Meta: 가속의 시간·빈도를 줄이고 이동 축을 제한하라 [R17] | 한 번에 한 가지. 비행 중엔 자전 각속도를 0으로 이즈 |
| 즉시 속도 변화·급가속 | Meta: 즉시 속도 변화는 편안함 위험 요인 [R17] | 모든 속도 변화는 1.2~2초 이상 이즈 |
| 주변 시야의 큰 광류 | Meta: 광류가 크고 빠를수록 벡션·불편 증가, 이동 중 비네트 권장 [R17] | 화면 가장자리 별은 밀도·속도를 낮춤, 비행 중 가장자리 노출 −30% |
| 고정 기준 없음 | Meta: 머리 움직임에만 반응하는 독립 배경, 안정된 시각 기준 권장 [R17] | 독·캡션·스카이박스를 '움직이지 않는 틀'로 항상 유지 |
| 부드러운 회전 강제 | Meta: 부드러운 회전은 선택 기능으로 [R17] | 설정에 자전 끄기·줄이기, OS 동작 줄이기면 자전 정지 + 크로스페이드 |
| 화면 롤(기울기) | (추론) 롤은 전정기관에 가장 낯선 움직임 | 롤 0° 고정 |
| 프레임 떨림 | Meta: 일정한 프레임 유지 [R17] | 60↔40 오락가락보다 30 고정이 낫다. 저전력·탭 숨김이면 정지 |
| 성능 함정 | 큰 가산 스프라이트 과다(overdraw), 셰이더 컴파일 멈칫 [R4], 발열 | 스프라이트 반경 상한, 사전 컴파일, 첫 프레임은 0.6초 페이드 인 |

---

## 2. 실제 은하의 3D 구조와 사실감 포인트 (아트 디렉터·모션 개발자용)

### 2-1. 구성 요소

| 요소 | 실제 (우리은하 기준) | 3D 모양 | 색 | 아트·모션 지침 (추론) |
|---|---|---|---|---|
| **얇은 원반** | 지름 약 10만 광년, 두께 약 1천 광년(약 100:1). 태양은 중심에서 약 2.6만 광년 [R19] | 납작한 원판. 바깥 가장자리는 모자챙처럼 살짝 휘고(warp) 두꺼워짐 | 전체는 크림~흰색 | 실제 비율이면 종이처럼 보임 → 중심부 두께 1:15~1:25로 과장. 가장자리에 아주 약한 휨 |
| **팽대부·막대** | 중심의 땅콩 모양 막대, 늙은 별. Gaia: 태양 쪽으로 더 기울어짐 [R13] | 길쭉한 타원체. 막대 양 끝에서 팔이 시작 | 크림·금·주황 | 가장 밝은 곳이지만 톤매핑으로 하얗게 날리지 않게. 막대는 강체 회전 |
| **나선팔** | 큰 팔 2개(방패-센타우루스, 페르세우스) + 작은 팔·지류(태양은 오리온 지류). Gaia: 팔이 더 많고 더 희미 [R13][R19] | 원반 안에만 있고 얇음 | 청백 + 분홍 점 | 팔은 별 덩어리가 아니라 **밝기 패턴**. 팔 사이에도 별이 있어야 함(밝기 대비 2~3:1) |
| **먼지띠** | 팔 안쪽 가장자리를 따라 가는 갈색·검은 실. 옆에서 보면 원반 가운데 한 줄 검은 띠(M104, NGC 891) [R18] | 원반 중앙면에 가장 얇게 | 짙은 갈색·검정 | **빛을 빼는 층**(곱하기). 사실감에 가장 크게 기여 |
| **HII 영역** | 젊은 별빛에 수소가 이온화된 별 탄생 구역. 사진에서 팔을 따라 박힌 분홍 덩어리 [R18] | 수십~수백 광년 덩어리 | 분홍·자홍 | 먼지띠 바로 바깥쪽. 생겨나 밝아졌다 사라지는 **'성운의 숨'**에 알맞음 |
| **청색 젊은 별·성단** | 뜨겁고 수명이 짧아 팔을 벗어나기 전에 사라짐 → 팔이 푸르게 보임 [R18] | 팔 위 작은 무리 | 청백 | 팔 위에서 태어나 팔 밖으로 나가며 서서히 꺼짐 = **'별의 생애'** |
| **늙은 별** | 팔 사이·팽대부에 매끄럽게 퍼짐 | 원반 전체 + 두꺼운 원반 | 노랑·주황 | 바탕 밀도 |
| **헤일로·구상성단** | 공 모양, 매우 희미. 구상성단 약 150개 [R19] | 구형 | 연노랑 | 원반 밖에 희미한 점 10~30개(입체 단서). 거의 돌지 않음 |
| **중심 블랙홀** | 가시광으로 보이지 않음 | — | — | 그리지 않는다. 빛나는 점 금지 |

### 2-2. 팔레트 (가시광 사진 기준, hex는 제안값 · 추론)

| 역할 | 제안 hex | 관찰 근거 |
|---|---|---|
| 우주 바탕 | `#05060C` ~ `#0B0E1A` (순검정 금지) | 장노출 사진의 하늘 바탕 |
| 팽대부 코어 → 가장자리 | `#FFF1D6` → `#F6C98A` | M51·M74 허블 사진의 중심 |
| 늙은 원반 별 | `#FFD9A8` | 팔 사이 바탕 |
| 젊은 청백 별 | `#A9C4FF` / `#DCE7FF` | NGC 4535 허블 사진 [R18] |
| HII 분홍 (코어) | `#F27BA8` (`#FFC2D8`) | 허블 가시광의 별 탄생 구역 [R18] |
| 반사 성운 | `#7FA7E0` | design-v3 P2와 같은 계열 |
| 먼지띠 (역광 가장자리) | `#1E140F` ~ `#3A2618` 곱하기 (`#6E4428`) | NGC 1300, M104 |
| 헤일로 | `#FFF3D1`, 알파 3~8% | — |
| **JWST 중적외선 모드** (따로) | 먼지 `#FF8A3D`·`#C8401E`, 늙은 별 중심은 파랑 | PHANGS: 파장에 색을 배정한 가색(false color) [R18] |

규칙: **가시광 팔레트 하나로 통일**한다. JWST의 주황·진홍 먼지는 파장을 색으로 바꾼 것이라 가시광과 섞으면 어색하다. 쓰려면 별도 '렌즈'(예: 집중 모드)로만. 사진 참고: M51, M74(허블·JWST 2022), NGC 1300(막대, PHANGS), NGC 4535, M104·NGC 891(옆면), M31. 이미지는 복사하지 않는다.

### 2-3. 회전의 느낌: 차등 회전과 감김 문제

| 사실 | 내용 | 아트·모션 번역 (추론) |
|---|---|---|
| **평평한 회전 곡선** | 중심 1~2kpc 밖에서는 공전 속도가 거의 일정(약 220~230km/s). 각속도 = 속도/반지름이라 반지름 2배면 한 바퀴 시간도 2배. 중심부는 강체처럼 돈다 [R19] | Ω(r) = Ω₀ · r₀ / max(r, r_core). 안/밖 비는 3~5배로 제한(실제는 더 큼) |
| **태양 공전 주기** | 약 2.3억 년 [R19] | 외곽 1회전 15분이면 **1초 ≈ 25만 년**. 설정 문구로 쓸 수 있음 |
| **감김 문제** | 별 덩어리로 된 팔이라면 차등 회전 몇 바퀴 만에 꽁꽁 감겨 사라짐. 실제 팔은 하나의 패턴 속도로 도는 **밀도파**이고 별은 팔을 지나간다 [R19] | **별 입자는 차등 회전, 팔 밝기·HII·청색 별 생성 확률은 강체 패턴(Ωp)**. 팔 모양은 유지되고 별은 팔을 지나며 밝아졌다 어두워짐 |
| **팔 위 순서** | 먼지띠(안쪽) → HII·청색 별 → 늙은 별로 흐려짐 [R18] | 패턴 각을 기준으로 먼지 → 분홍 → 청백 순 오프셋 |
| **시점** | 정면은 팔이 잘 보이지만 평면, 옆면은 먼지띠만 보임 | 기울기 55~65°. 공간 이동 때만 ±10° 안에서 바꿈 |

---

## 3. '못 끊는' 학습·생산성 앱 12선

축 약어: **축적**(가치가 쌓임) · **전환**(옮기기 어려움) · **의식**(매일 같은 시작·끝) · **속도** · **감정**(보상)

### 3-1. 앱별 분석

| # | 앱 | 계속 쓰는 진짜 이유 | 핵심 장치·근거 | 비판·다크 패턴 | 쓸 것 / 피할 것 |
|---|---|---|---|---|---|
| 1 | **Duolingo** | 의식·감정 | 스트릭·일일 목표·축하 애니메이션. 자사 실험: 스트릭 연장 애니메이션 → 신규 7일 잔존 +1.7%, '스트릭 내기' → 7일 잔존 +14%, 1문제만으로 연장하게 했더니 DAU 효과 없음 [R20]. Apple Design Award 2023 Delight and Fun **(확인)** [R22] | 슬픈 부엉이·죄책감 알림, 손실 회피 이용, 아이들의 스트릭 불안 지적(의견 글 위주) [R21] | 쓸 것: 1분짜리 시작, 의미 있는 축하. 피할 것: 마스코트 감정 협박, 끊기면 0, 리그 강등 |
| 2 | **Anki** | 축적·전환 | 수년치 카드와 복습 기록. FSRS로 목표 기억률에 맞춘 일정 [R28][L23]. 무료·공유 덱 | 며칠 빠지면 밀린 복습이 쌓여 포기(커뮤니티 통념, 추론). 낡은 UI [이전 S10] | 쓸 것: FSRS, 목표 기억률. 피할 것: 밀린 숫자 공포 → 하루 상한·자동 분산 |
| 3 | **Notion** | 전환·축적 | 업무·DB·템플릿이 한곳에 묶임 | 꾸미기에 드는 시간, 오프라인 약함 [이전 S5][이전 S17] | 쓸 것: 같은 데이터 여러 뷰. 피할 것: 빈 캔버스 꾸미기 루프 |
| 4 | **Obsidian** | 축적(링크) | 로컬 마크다운·백링크·플러그인. '파일이 앱보다 오래간다'(File over app) 철학 [R26] → 내 데이터라는 신뢰가 곧 잔존 이유 | 가파른 학습곡선 [이전 S7]. 그래프 뷰는 예쁘지만 실제로는 덜 쓴다는 커뮤니티 의견 **(미확인)** | 쓸 것: 내보내기 보장, 링크 = 가치. 피할 것: 의미 없는 장식 그래프 → 은하는 실제 기억률·연결로 그린다 |
| 5 | **GoodNotes** | 축적·속도 | 수년치 손필기·PDF, 펜 손맛 | 5→6 구독 전환 반발 [이전 S2] | 쓸 것: 펜 지연 최소. 피할 것: 산 기능 유료화 |
| 6 | **Forest** | 감정·의식 | 집중하면 나무가 자라고 앱을 떠나면 시듦. 코인으로 Trees for the Future가 실제 나무를 심음. 심은 수는 출처마다 다름 [R24] | 실패를 '죽은 나무'로 영구 표시(처벌) | 쓸 것: 집중이 눈에 보이게 자람, 누적 숲. 피할 것: 죽음·처벌 표현 |
| 7 | **Things 3** | 의식·속도 | '오늘'과 '오늘 저녁' 구분, 빠른 입력, 차분한 모션, 일회 구매. Apple Design Award 2017 **(미확인)** | 기능 업데이트가 느림(추론) | 쓸 것: 아침에 고르고 저녁에 닫는 의식 |
| 8 | **Linear** | 속도 | 로컬 동기화·낙관적 UI·키보드, 의견이 분명한 흐름 [이전 S30] | 겉모양만 베끼면 공허 [이전 S30] | 쓸 것: 누르면 즉시 반영, ⌘K |
| 9 | **Craft** | 감정 | 손대지 않아도 예쁜 기본값. Mac App of the Year 2021 **(미확인)** | Apple 기기 중심 | 쓸 것: 기본값이 곧 완성 |
| 10 | **Readwise** | 축적·의식 | 하이라이트를 간격 반복으로 다시 띄우는 Daily Review(메일·앱), Kindle 등에서 가져오기 [R25] | 매일 메일이 피로(추론) | 쓸 것: 지난 필기에서 '오늘의 회상 5개'. 피할 것: 매일 메일 |
| 11 | **RemNote** | 축적 | 노트 문장 안에서 바로 카드 [이전 S9] | 복잡한 UI, 무료 한도 | 쓸 것: 인라인 카드 문법 |
| 12 | **Arc** | 의식·속도 | 사이드바·Spaces로 맥락 분리, 오래된 탭을 자동 보관해 늘 깨끗함(기본 12시간, **미확인**) | 2025년 신규 개발 중단, 후속 제품으로 이동 [research.md 3-3] | 쓸 것: 조용한 자동 정리. 피할 것: 유지하지 못할 실험 UI |

### 3-2. 다섯 축의 결론

| 축 | 사람을 붙잡는 것 | 결에서의 형태 (추론) |
|---|---|---|
| 축적 | Anki 카드, Obsidian 링크, GoodNotes 필기 | **나의 은하 = 줄지 않는 지식 지도.** 별 = 개념, 밝기 = 기억률, 성간 물질 = 연결 |
| 전환 | 데이터가 앱에 묶임 | 가치로만 묶는다. 데이터는 언제든 1클릭 내보내기 |
| 의식 | Things의 '오늘', Duolingo의 매일, Readwise의 아침 | 하루 2번: 아침 '오늘 고르기', 밤 '은하 닫기' |
| 속도 | Linear | 입력 후 50ms 안에 화면 반영(목표) |
| 감정 | Duolingo 축하 애니메이션 +1.7% [R20] | 예측 가능한 보상(별 점화) + 가끔 있는 발견(오래된 노트 회상) |

### 3-3. 다크 패턴 → 결의 대안

| 다크 패턴 | 왜 해로운가 (근거) | 결의 대안 |
|---|---|---|
| **끊기면 0이 되는 스트릭** | 끊긴 기록을 보여 주면 이후 참여가 줄고, 자기 탓으로 여길수록 심함. 기록을 '복구'할 수 있으면 약해짐 [R23]. 습관 자동화 중앙값 66일, 하루 빠진 것은 습관 형성에 큰 영향 없음 [L19] | 누적형(총 별 수·은하 크기는 줄지 않음), 주간 리듬(7일 중 n일), 쉬는 날 미리 지정, 놓친 날은 '복구 복습'으로 이어 붙이기 |
| **죄책감 알림·마스코트 감정** | 죄책감·손실 회피를 이용한다는 비판 [R21] | 하루 1회, 사용자가 정한 시각, 정보형 문구("복습 12장 준비됨") |
| **랭킹·리그 강등** | 사회 비교 압박 (v3에서 이미 제외) | 과거의 나와만 비교 |
| **예상된 물질 보상 남발** | 예상된 보상은 내적 동기를 깎을 수 있음(과잉정당화) [L20] | 정보형 피드백(기억률 지도) + 예측 못 한 발견 |
| **밀린 숫자 공포** (Anki) | 숫자가 쌓이면 시작 장벽이 됨(추론) | 하루 상한·자동 분산. 새 주·새 학기의 '새 출발' 버튼(새 출발 효과 [L21]) |
| **데이터 인질** | 신뢰를 잃음 | 내보내기 보장을 UI 문구로 |
| **산 기능 유료화** | GoodNotes·Notability·Quizlet 반발 [이전 S2][이전 S3][이전 S10] | 핵심 기능은 무료로 고정 |
| **무한 꾸미기** | 공부 대신 도구 손질 [이전 S17] | 기본값이 완성. 소유감은 꾸미기 대신 '쌓기'로(직접 만든 것을 더 아끼는 IKEA 효과 [L22]) |

---

## 4. 학습 과학 근거 10개

Dunlosky 등(2013) 리뷰는 10가지 학습법 중 **인출 연습·간격 학습을 '높은 효용'**, 교차·정교화 질문·자기 설명을 '중간', **형광펜·다시 읽기·요약을 '낮은 효용'**으로 평가했다 [L1]. → 형광펜은 카드로 가는 입구로만 쓴다.

| # | 원리 | 근거 요약 | 앱 기능으로 | 하늘 사건 예 |
|---|---|---|---|---|
| 1 | **인출 연습 (시험 효과)** | 다시 읽기보다 떠올리기가 1주 뒤 기억에 유리 [L2]. 메타분석 g≈0.50, 피드백이 있으면 더 큼 [L3]. 실전 연습 메타분석 g≈0.61 [L4] (수치 확인 [R29]) | 노트 끝 '떠올리기'(가리고 말하기·쓰기), 카드는 답 보기 전에 먼저 써 보기 선택지 | 인출 성공 → 별 점화 |
| 2 | **간격 반복** | 몰아서보다 나눠서. 최적 간격은 시험까지 기간이 1주면 약 20~40%, 1년이면 약 5~10% [L5][L6]. FSRS는 기억 모델로 일정을 최적화 [L23][R28] | 시험 D-day 역산, 목표 기억률(85~90%), 하루 상한 | 복습한 별이 다시 밝아짐 |
| 3 | **교차 학습** | 수학 문제를 섞어 풀면 1주 뒤 63% 대 20% [L7]. 그런데 학습자는 몰아서가 낫다고 믿음 [L8]. 메타분석 g≈0.42, 비슷한 범주 구분에 특히 효과 [L9] | 복습 큐에서 비슷한 개념·과목 섞기(기본값), 왜 섞는지 한 줄 안내 | 다른 성단의 별이 번갈아 깜박임 |
| 4 | **정교화·자기 설명** | '왜?'를 묻고 자기 말로 설명. 자기 설명 메타분석 g≈0.55 [L10] | 카드 뒷면 '왜?' 칸, 링크를 만들 때 이유 한 줄 | 링크 = 두 별 사이 성간 물질 |
| 5 | **생성 효과** | 직접 만든 답·단서가 더 오래 남음. 메타분석 d≈0.40 [L11] | AI가 카드를 **전부** 만들지 않게. 빈칸 위치는 사용자가 고르고 AI는 초안만 | 직접 만든 카드의 별은 조금 더 밝게 |
| 6 | **메타인지 (학습 착각 교정)** | 잘 읽히면 안다고 착각하고, 몰아서 하기·다시 읽기를 선호함 [L12][L8] | 답 보기 전 확신도(1~4) → 결과와 비교하는 '보정 지도', '안다고 생각했던 별' 표시 | 확신과 결과가 다르면 별이 아주 약하게 흔들림 |
| 7 | **수면·휴식 응고화** | 수면이 기억을 굳힘 [L13]. 학습 직후 10분 동안 멍하게 쉬면 1주 뒤 기억이 좋아짐 [L14] | 집중 세션 뒤 '조용한 10분'(은하만 느리게, 입력 없음), 밤 늦게는 '자고 내일 1회 복습' 안내 | 휴식 동안 성운이 숨 쉼 |
| 8 | **목표 설정·실행 의도** | 구체적·도전적 목표가 '최선을 다하자'보다 나음 [L15]. '만약 X면 Y한다' 실행 의도 메타분석 d≈0.65 [L16] | 플래너에 '언제·어디서·무엇을' 한 문장, 오늘의 목표 1개 | 목표 별(성도)에 표시 |
| 9 | **정해진 휴식** | 24분 공부·6분 휴식이 자율 휴식보다 기분·효율이 좋았음 [R27]. 2025 후속 연구는 결과가 엇갈림 [R27] | 기본 24/6 또는 25/5, 자율 모드 선택, 휴식 알림은 부드럽게 | 휴식 = 은하 노출 낮춤 |
| 10 | **사전 질문 (틀려도 좋다)** | 배우기 전에 답해 보면 틀려도 이후 학습이 좋아짐 [L17] | 강의 전 '예상 질문 3개', 틀린 답은 기록에 남기지 않음 | 새 성운(모르는 영역)이 희미하게 보임 |

참고: 손필기가 타이핑보다 낫다는 연구 [L18a]는 재현 연구에서 뚜렷한 우위를 찾지 못했다 [L18b]. 손필기는 **선호와 표현의 기능**으로 내세우고, 기억 효과로 광고하지 않는다.

---

## 5. 기획자·아트 디렉터·모션 개발자가 바로 쓸 시사점 12줄

1. **[모션] 입체감의 1순위는 운동 시차다.** 하늘을 4층(고정 스카이박스 / 헤일로 / 원반 / 앞쪽 별·먼지)으로 나누고 층마다 깊이를 다르게 두면, 느린 자전만으로도 3D가 읽힌다.
2. **[모션] 별은 차등 회전, 팔은 강체 패턴.** 별 입자는 Ω∝1/r(안쪽 3~5배 빠르게, 중심부는 강체), 팔 밝기·HII·청색 별 생성은 하나의 패턴 각속도로 돌려 감김 문제를 피한다.
3. **[모션] 피사계 심도는 Star Atlas처럼 가짜로.** 점 크기·알파를 초점 거리 차로 바꾸면 후처리 없이 깊이가 생긴다. 초점은 지금 머무는 공간이다.
4. **[아트] 카메라는 원반 위 25~35°에서 3/4로 본다.** 정면은 2D 그림이 되고 옆면은 팔이 사라진다.
5. **[아트] 사실감 5요소:** 크림·금 팽대부와 막대, 팔 안쪽 가장자리의 갈색 먼지띠(곱하기), 팔을 따라 박힌 분홍 HII, 팔 위 청백 젊은 별, 거의 안 보이는 구상성단 헤일로. 보라·네온은 쓰지 않는다.
6. **[아트] 가시광(허블) 팔레트 하나로 통일한다.** JWST 중적외선의 주황·진홍은 가색이라, 쓴다면 별도 렌즈 모드로만.
7. **[모션] 멀미 안전 기본값:** 외곽 1회전 10분 이상, 회전과 이동은 동시에 하지 않음, 롤 0°, 모든 속도 변화 1.2초 이상 이즈, 독·캡션·스카이박스를 고정 기준으로 유지, 동작 줄이기면 자전 정지와 크로스페이드.
8. **[모션] 성능 등급과 안전장치:** 폰 8만~15만 / iPad 15만~30만 / 데스크톱 50만~200만 점. HDR + 톤매핑, 셰이더 사전 컴파일, 탭이 숨겨지거나 저전력이면 정지.
9. **[기획] 못 끊는 이유는 쌓인 가치다.** 나의 은하는 줄지 않고 커지기만 하는 지식 지도여야 하고, 데이터는 언제든 꺼낼 수 있어야 신뢰가 생긴다(File over app).
10. **[기획] 스트릭 대신 '회복할 수 있는 리듬'.** 끊긴 기록을 강조하면 사람이 떠난다 [R23]. 하루 빠져도 습관에는 큰 영향이 없다 [L19]. 주간 리듬, 미리 정하는 쉬는 날, 복구 복습, 새 출발 버튼으로 간다.
11. **[기획] 기본 동작을 '높은 효용' 두 가지로.** 노트 끝 '떠올리기'와 시험일 역산 FSRS, 섞어서 복습. 형광펜·다시 읽기는 카드로 가는 입구로만 쓰고, AI는 카드 초안만 만들어 생성 효과를 지킨다.
12. **[기획·모션] 하늘은 학습 과학 행동에만 반응한다.** 인출 성공 = 별 점화, 간격 복습 = 별이 다시 밝아짐, 링크 = 성간 물질, 휴식 10분 = 성운의 숨, 확신과 결과의 차이 = 별의 미세한 흔들림. 의식은 아침 '오늘 고르기'와 밤 '은하 닫기' 두 번이다.

---

## 출처

**웹 [R]**
- [R1] Making 100,000 Stars (web.dev): https://web.dev/case-studies/100000stars · 작품: https://experiments.withgoogle.com/100000-stars
- [R3] Awwwards Sites of the Year: https://www.awwwards.com/websites/sites_of_the_year/
- [R4] Awwwards Igloo Inc 사례 연구: https://www.awwwards.com/igloo-inc-case-study.html
- [R5] 80.lv, Messenger: https://80.lv/articles/deliver-mail-on-tiny-colorful-planet-in-this-relaxing-web-game
- [R6] Awwwards Bruno Simon 포트폴리오 사례 연구: https://www.awwwards.com/brunos-portfolio-case-study.html
- [R7] Utsubo, Three.js 2026 (WebGPU): https://www.utsubo.com/blog/threejs-2026-what-changed
- [R8] Webby Crafted with Code, Star Atlas: https://www.webbyawards.com/crafted-with-code/star-atlas/ · Hello Monday: https://hellomonday.com/work/staratlas · Webby 2022: https://winners.webbyawards.com/2022/websites-and-mobile-sites/general-websites-and-mobile-sites/entertainment/214393/star-atlas · Awwwards 2021 Users' Choice: https://awwwards.com/annual-awards-2021/site-of-the-year-users-choice
- [R9] Awwwards, Active Theory v4 SOTM 2018.1: https://www.awwwards.com/active-theory-v4-wins-january-2018-site-of-the-month.html
- [R10] Lusion Awwwards 프로필: https://www.awwwards.com/lusion/ · D&AD: https://www.dandad.org/work/d-ad-awards-archive/lusionco
- [R11] Wikipedia, NASA's Eyes: https://en.wikipedia.org/wiki/NASA%27s_Eyes · https://eyes.nasa.gov
- [R12] JPL 웨비 수상: https://www.jpl.nasa.gov/news/nasa-wins-4-webbys-4-peoples-voice-awards/ · https://www.jpl.nasa.gov/news/nasa-wins-3-2021-webby-awards-2-peoples-voice-honors/ · Khronos: https://www.khronos.org/news/permalink/nasas-webgl-project-won-a-webby-award
- [R13] ESA, The best Milky Way map by Gaia (2025.1): https://www.esa.int/ESA_Multimedia/Images/2025/01/The_best_Milky_Way_map_by_Gaia · https://www.cosmos.esa.int/web/gaia/milky-way
- [R15] Three.js Journey: https://threejs-journey.com/lessons/galaxy-generator · https://threejs-journey.com/lessons/animated-galaxy (강의 내용은 기억 기반, 미확인)
- [R16] three.js forum, GPGPU 은하 입자: https://discourse.threejs.org/t/gpgpu-galaxy-particles/88937
- [R17] Meta, Locomotion best practices: https://developers.meta.com/horizon/design/locomotion-best-practices/ · Comfort: https://developers.meta.com/horizon/design/comfort/
- [R18] Univ. of Arizona, PHANGS JWST: https://news.arizona.edu/story/webb-telescope-reveals-stunning-structures-nearby-spiral-galaxies · Sky & Telescope: https://skyandtelescope.org/astronomy-news/webb-telescope-unveils-19-galaxies-in-a-new-light/ · ESA/Hubble NGC 4535: https://www.astropix.org/image/esahubble/potw2103a
- [R19] 일반 참고(이번 세션 미조회): Wikipedia Milky Way https://en.wikipedia.org/wiki/Milky_Way · Galaxy rotation curve https://en.wikipedia.org/wiki/Galaxy_rotation_curve · Density wave theory https://en.wikipedia.org/wiki/Density_wave_theory
- [R20] Duolingo 엔지니어링 블로그: https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals · https://blog.duolingo.com/how-duolingo-streak-builds-habit · Lenny's Newsletter: https://lennysnewsletter.com/p/behind-the-product-duolingo-streaks
- [R21] 비판(의견 글): https://screenwiseapp.com/guides/managing-duolingo-streaks-when-gamification-becomes-stressful · https://terms.law/ToS-Watchdog/language-learning/duolingo/
- [R22] Apple Design Awards 2023: https://www.apple.com/newsroom/2023/06/apple-announces-winners-of-the-2023-apple-design-awards
- [R23] Silverman & Barasch (2023), On or Off Track, *J. Consumer Research* 49(6): https://udspace.udel.edu/handle/19716/34160 · CU Boulder: https://www.colorado.edu/business/faculty-research/2023/04/19/or-track-how-broken-streaks-affect-consumer-decisions
- [R24] Wikipedia, Forest: https://en.wikipedia.org/wiki/Forest_(application) · https://forestapp.cc
- [R25] Readwise App Store: https://apps.apple.com/us/app/-/id1476885528
- [R26] Steph Ango, File over app: https://stephango.com/file-over-app (URL 미확인)
- [R27] Biwer et al. (2023) BJEP: https://cris.maastrichtuniversity.nl/en/publications/understanding-effort-regulation-comparing-pomodoro-breaks-and-sel · Smits et al. (2025): https://pmc.ncbi.nlm.nih.gov/articles/PMC12292963/
- [R28] Anki 매뉴얼 FSRS: https://docs.ankiweb.net/deck-options.html (미조회)
- [R29] 효과 크기 확인: https://www.frontiersin.org/articles/10.3389/fpsyg.2018.02412/full · https://rex.libraries.wsu.edu/esploro/outputs/journalArticle/Rethinking-the-Use-of-Tests-A/99900601154801842

**학술 [L]** (문헌, DOI)
- [L1] Dunlosky et al. (2013) *PSPI* 14(1): https://doi.org/10.1177/1529100612453266
- [L2] Roediger & Karpicke (2006) *Psych. Science* 17(3): https://doi.org/10.1111/j.1467-9280.2006.01693.x
- [L3] Rowland (2014) *Psych. Bulletin* 140(6): https://doi.org/10.1037/a0037559
- [L4] Adesope, Trevisan & Sundararajan (2017) *Rev. Educ. Research* 87(3): https://doi.org/10.3102/0034654316689306
- [L5] Cepeda et al. (2006) *Psych. Bulletin* 132(3): https://doi.org/10.1037/0033-2909.132.3.354
- [L6] Cepeda et al. (2008) *Psych. Science* 19(11): https://doi.org/10.1111/j.1467-9280.2008.02209.x
- [L7] Rohrer & Taylor (2007) *Instructional Science* 35: https://doi.org/10.1007/s11251-007-9015-8
- [L8] Kornell & Bjork (2008) *Psych. Science* 19(6): https://doi.org/10.1111/j.1467-9280.2008.02127.x
- [L9] Brunmair & Richter (2019) *Psych. Bulletin* 145(11): https://doi.org/10.1037/bul0000209
- [L10] Bisra et al. (2018) *Educ. Psych. Review* 30: https://doi.org/10.1007/s10648-018-9434-x
- [L11] Bertsch et al. (2007) *Memory & Cognition* 35: https://doi.org/10.3758/BF03193441
- [L12] Bjork, Dunlosky & Kornell (2013) *Annu. Rev. Psych.* 64: https://doi.org/10.1146/annurev-psych-113011-143823
- [L13] Rasch & Born (2013) *Physiological Reviews* 93(2): https://doi.org/10.1152/physrev.00032.2012
- [L14] Dewar et al. (2012) *Psych. Science* 23(9): https://doi.org/10.1177/0956797612441220
- [L15] Locke & Latham (2002) *American Psychologist* 57(9): https://doi.org/10.1037/0003-066X.57.9.705
- [L16] Gollwitzer & Sheeran (2006) *Adv. Exp. Soc. Psych.* 38: https://doi.org/10.1016/S0065-2601(06)38002-1
- [L17] Richland, Kornell & Kao (2009) *J. Exp. Psych.: Applied* 15(3): https://doi.org/10.1037/a0016496
- [L18a] Mueller & Oppenheimer (2014) *Psych. Science* 25(6): https://doi.org/10.1177/0956797614524581 · [L18b] Morehead, Dunlosky & Rawson (2019) *Educ. Psych. Review* 31: https://doi.org/10.1007/s10648-019-09468-2
- [L19] Lally et al. (2010) *Eur. J. Soc. Psych.* 40(6): https://doi.org/10.1002/ejsp.674
- [L20] Deci, Koestner & Ryan (1999) *Psych. Bulletin* 125(6): https://doi.org/10.1037/0033-2909.125.6.627
- [L21] Dai, Milkman & Riis (2014) *Management Science* 60(10): https://doi.org/10.1287/mnsc.2014.1901
- [L22] Norton, Mochon & Ariely (2012) *J. Consumer Psych.* 22(3): https://doi.org/10.1016/j.jcps.2011.08.002
- [L23] Ye, Su & Cao (2022) KDD, FSRS 기반 알고리즘: https://doi.org/10.1145/3534678.3539081
