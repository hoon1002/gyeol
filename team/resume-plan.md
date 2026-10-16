# 재개 계획 (사용량 한도로 일시 정지, 2026-10-17 16:18 UTC)

재개 시각: 5시간 한도 초기화 17:50 UTC 이후.

## 끝난 것
- 은하수 엔진 앱 통합, 전환 굽기 0회 (리더 측정: 긴 작업 0, p95 ~9ms)
- 기능↔하늘 연결 지도 51행, 카메라 장소 지도·비행 안무 (design-v3-motion.md, design-v3-camera.md)
- 앱 v3: 글 다이어트(7화면+상황 9), 별빛 금, 가는 글꼴, 원형 모티프 제거 → ProgressLine, 하늘 사건 연결(집중 birth/grow/drawLink/fade, 복습 relight/swellBand/meteor, 시간대·렌즈·첫 진입)
- 은하 카메라 엔진: 7개 장소 비행, 깊이 5층 시차, 줌하면 별이 풀려 나옴, travel prop, useSkyCamera, useSkyPick

## 남은 일 (우선순위)
1. [앱] 집중 화면 SVG `<line>` NaN 콘솔 에러 수정
2. [앱] 카메라 연결: 데이터 별 누르기 → useSkyPick + useSkyCamera.flyTo, 닫기 → back, 설정 '공간 이동: 비행·짧게·끔' → FieldProvider travel
3. [앱+fx] 전환·비행 첫 프레임 25–42ms → ≤20ms (keep-alive 마운트, 커밋 한 프레임 지연, View Transition 스냅샷 범위 축소)
4. [리더] 390/820/1180/1440·오프라인·동작 줄이기 검증, 보안 점검, 사용자 보고
5. (여유 시) 장소별 고해상도 타일, 희미한 별 깊이 층, gatherDust, 유성 켬·끔 설정, '나의 은하' 시트
