# 🗺️ RP World Tracker v0.2.0-beta

SillyTavern RP 확장 프로그램 — AI 응답에서 장소를 자동 감지하고 지도에 표시합니다.

## 주요 기능

### 🔍 자동 장소 감지
- 한국어 + 영어 장소 감지 (4가지 방법)
- 새 장소 자동 등록 (수정/취소 가능)
- 대소문자 무시, 인명/형용사/경유지 필터

### 🗺️ 듀얼 맵 모드
- **📊 노드 그래프** — SVG 지도, 드래그/핀치줌/팬
- **🌍 실제 지도** — Leaflet + CartoDB Voyager 타일
- 패널에서 모드 전환 가능

### 🔎 장소 검색 (실제 지도 모드)
- Nominatim으로 실제 장소 검색
- 검색 결과 선택 → 좌표 자동 배치

### 🤖 AI 프롬프트 주입
- 현재 씬 위치를 AI 컨텍스트에 주입
- 기억 모드: 자연 (시간 경과로 흐려짐) / 완벽 (정확)
- 방문 횟수, 인근 장소, 이동 히스토리

### 📱 모바일 호환
- 3중 이벤트 시스템 (데스크탑+모바일 동시 지원)
- 인라인 팝오버 & 토스트 (모바일 안정)
- 터치 최적화 SVG 히트 테스트

### 🧭 나침반
- 커스텀 SVG 나침반 (N/S/E/W 꽃잎 디자인)
- 지도 좌하단 고정

## 파일 구조 (11파일)
```
manifest.json          — 확장 메타데이터
index.js              — 진입점, 이벤트, CDN 로더
db.js                 — IndexedDB 래퍼
location-manager.js   — 장소 CRUD + 이동 추적
detector.js           — 한영 장소 감지 엔진
prompt-injector.js    — AI 프롬프트 생성
map-renderer.js       — SVG 노드 그래프 (줌/팬/드래그)
leaflet-renderer.js   — Leaflet 실제 지도 + Nominatim
ui-manager.js         — 패널 UI 전체
style.css             — 모바일 퍼스트 스타일
README.md             — 이 파일
```

## 설치 방법
1. `SillyTavern/data/default-user/extensions/third-party/rp-world-tracker/` 에 복사
2. SillyTavern 확장 메뉴에서 활성화
3. RP 채팅 시작 → 장소 자동 감지!

## 로드맵
- [ ] 확장 전용 AI 모델 연동 (감지 정확도 향상)
- [ ] 장소 메모리 시스템 (추억 저장 + 기억 변형)
- [ ] 캐릭터 카드 지역 자동 감지
- [ ] 좌표 기반 노드 자동 배치 (약도)
- [ ] 커스텀 장소 단어 설정
- [ ] 로어북 연동
