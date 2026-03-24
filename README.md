# 🗺️ RP World Tracker

**SillyTavern 확장 — RP 속 세계를 지도로 기록하세요**

AI 응답에서 장소를 감지하고, 캐릭터의 이동을 지도 위에 자동으로 추적하는 SillyTavern 확장입니다.
판타지 모험의 탐험 지도로, 혹은 일상물의 추억 지도로 사용할 수 있습니다.

---

## ✨ 기능

### Phase 1 (현재)
- 📍 **장소 등록/관리** — 이름, 별칭, 메모와 함께 장소를 등록
- 🗺️ **자동생성 맵** — 등록된 장소를 노드 그래프로 시각화
- 🖱️ **드래그 배치** — 맵 위에서 장소 노드를 자유롭게 드래그
- 👣 **이동 추적** — 장소 간 이동 기록 및 발자국 경로 표시
- 📊 **방문 통계** — 장소별 방문 횟수, 첫 방문/최근 방문 시간
- 📝 **장소 메모** — 각 장소에 자유롭게 메모 기록
- 💾 **채팅방별 독립 관리** — IndexedDB 기반 영구 저장

### 예정 기능
- 🔍 AI 응답 자동 장소 감지 (Phase 2)
- 🖼️ 프리셋 맵 — 이미지 기반 POI 배치 (Phase 3)
- 🚶 이동 경로 타임라인 (Phase 4)
- 🎨 마법사의 지도 스타일 발자국 애니메이션 (Phase 5)
- 📖 로어북 연동 — 장소별 추억/이벤트 표시

---

## 📦 설치

### 방법 1: Git Clone (추천)
```bash
cd [SillyTavern 설치 경로]/data/default-user/extensions/
git clone https://github.com/[your-username]/rp-world-tracker.git
```

### 방법 2: SillyTavern 내 설치
1. SillyTavern 열기
2. **Extensions** → **Install Extension**
3. URL 입력: `https://github.com/[your-username]/rp-world-tracker`

설치 후 SillyTavern을 새로고침하세요.

---

## 🎮 사용법

1. **확장 설정**에서 `🗺️ RP World Tracker` 활성화
2. `🗺️ 월드 맵 열기` 버튼 클릭
3. 사이드 패널에서 장소 추가
4. 장소 클릭 → 메모 작성, 이동 실행
5. 맵 위 노드를 드래그해서 위치 조정

---

## 📋 변경 이력

### v0.1.0
- Phase 1 릴리스
- 기본 확장 구조 및 IndexedDB 설정
- 장소 CRUD (생성/조회/수정/삭제)
- 자동생성 노드 그래프 맵
- 사이드 패널 UI (장소 목록, 이동 히스토리)
- 장소 상세 팝오버 (방문 통계, 메모)
- 마법사의 지도 스타일 양피지 테마

---

## 🛠️ 기술 스택

- Vanilla JavaScript (ES Modules)
- IndexedDB (영구 저장)
- SVG (맵 렌더링)
- SillyTavern Extension API

---

## 📜 라이선스

MIT License
