# 🗺️ RP World Tracker v0.2.0-beta

**SillyTavern 확장 — RP 속 세계를 지도로 기록하세요**

AI 응답에서 장소를 자동 감지하고, 캐릭터의 이동을 지도 위에 추적하는 SillyTavern 확장입니다.
판타지 모험의 탐험 지도로, 혹은 일상물의 추억 지도로 사용할 수 있습니다.

---

## ✨ 기능

### 핵심
- 📍 **자동 장소 감지** — AI 응답에서 이동/위치 표현을 자동으로 감지
- 🤖 **AI 프롬프트 주입** — 현재 위치, 방문 횟수, 메모를 AI에게 자동 전달 → RP 퀄리티 향상
- 💭 **기억 모드** — 완벽한 기억 / 자연스러운 기억(시간 경과 시 요약) 선택 가능
- 🗺️ **노드 그래프 맵** — 등록된 장소를 시각적으로 표시, 드래그로 자유 배치
- 👣 **이동 추적** — 장소 간 이동 기록 + 발자국 경로 표시
- 📊 **방문 통계** — 장소별 방문 횟수, 첫 방문/최근 방문 시간
- 📝 **장소 메모** — 각 장소에 추억/이벤트 기록
- 🆕 **미등록 장소 발견** — 새로운 장소 등장 시 원클릭 등록

### 설정
- 🔍 장소 자동 감지 ON/OFF
- 📍 이동 알림 토스트 ON/OFF
- 🤖 AI 프롬프트 주입 ON/OFF
- 💭 기억 모드 전환 (완벽/자연)

---

## 📦 설치

### Git Clone
```bash
cd [SillyTavern]/data/default-user/extensions/
git clone https://github.com/[your-username]/rp-world-tracker.git
```

### SillyTavern 내 설치
1. Extensions → Install Extension
2. URL: `https://github.com/[your-username]/rp-world-tracker`

설치 후 SillyTavern 새로고침

---

## 🎮 사용법

1. 확장 설정에서 **🗺️ RP World Tracker** 활성화
2. **🗺️ 월드 맵 열기** 클릭
3. RP를 진행하면 AI 응답에서 장소를 자동 감지
4. 새 장소 발견 시 토스트 → "등록" 클릭
5. 사이드 패널에서 장소 메모, 이동 히스토리 확인
6. AI 프롬프트 주입으로 RP 퀄리티 자동 향상!

---

## 📁 파일 구조

```
rp-world-tracker/
├── manifest.json        # 확장 메타데이터
├── index.js             # 진입점 + 이벤트 훅
├── db.js                # IndexedDB 관리
├── location-manager.js  # 장소 CRUD + 거리 + 이동
├── detector.js          # AI 응답 장소 감지
├── prompt-injector.js   # AI 프롬프트 주입
├── map-renderer.js      # SVG 노드 그래프 렌더링
├── ui-manager.js        # UI (패널, 팝오버, 목록)
├── style.css            # 밝은 파스텔 테마
└── README.md
```

---

## 🎨 개발 원칙

1. **자동 우선** — 유저는 구경만, 수동은 보조
2. **AI 프롬프트 주입 최우선** — 확장 켜면 AI 응답 퀄리티 체감 상승
3. **감정 피드백 항상** — 방문 알림, 추억 메모, 통계로 "나중에 보는 맛"

---

## 📋 변경 이력

### v0.2.0-beta
- AI 프롬프트 주입 (Selective Injection)
- 기억 모드 (완벽/자연)
- 미등록 장소 발견 + 원클릭 등록
- 장소 상태 필드
- 거리/시간 시스템 기반
- 밝은 파스텔 테마
- 파일 모듈 분리

### v0.1.0
- 기본 확장 구조 및 IndexedDB
- 장소 CRUD + 자동 감지
- 노드 그래프 맵
- 사이드 패널 UI

---

## 🛠️ 기술 스택

- Vanilla JavaScript (ES Modules)
- IndexedDB
- SVG (맵 렌더링)
- SillyTavern Extension API

---

## 📜 라이선스

MIT License
