# 메이플 프사 메이커 (MapleThumbMaker)

메이플스토리 캐릭터 이름으로 **카카오톡 프로필 사진용 캐릭터 카드**(1080×1080 PNG)를 만드는 웹사이트입니다.

- 카드 중앙에는 캐릭터 **흉상**을 크게, 위아래와 모서리에는 이름·레벨·직업·월드·해방 여부·길드·전투력 등을 배치합니다.
- 카카오톡은 이미지 전체를 둥근 사각형(superellipse, n≈2.5) 마스크로 잘라 아이콘으로 씁니다. 이름·레벨·직업은 아이콘에도 보이고, 월드·해방·길드·전투력은 아이콘에서 가려지는 네 모서리에 들어가 프로필을 크게 볼 때만 보입니다. "카톡 아이콘 미리보기"와 "가려지는 부분 표시"로 확인할 수 있습니다.
- 캐릭터 정보는 [NEXON Open API](https://openapi.nexon.com/)를 Cloudflare Worker에서 호출해 가져옵니다(API 키는 서버에만 보관).

## 구조

```
public/            정적 사이트 (index.html, app.js, card.js, style.css) — Workers Static Assets로 제공
src/worker.js      Worker 진입점: /api/* 라우팅, 나머지는 정적 파일
src/api/
  character.js     GET /api/character?name=  → ocid 조회 + basic/stat/union/popularity 합쳐서 반환
  image.js         GET /api/image?url=&action=&emotion=&wmotion=  → 캐릭터 외형 이미지 프록시
src/nexon.js       넥슨 API 호출, 오류 메시지, 엣지 캐시 헬퍼
wrangler.toml      Worker 설정 (name, main, assets)
```

해방 여부는 `character/basic`의 `liberation_quest_clear` 값(0 없음, 1 제네시스 해방, 2 데스티니 해방, 3 데스티니 2차 초월)을 사용합니다.

## 로컬 실행

1. [NEXON Open API](https://openapi.nexon.com/)에서 메이플스토리 애플리케이션을 등록하고 API 키를 발급받습니다.
2. `.dev.vars.example`을 `.dev.vars`로 복사하고 키를 넣습니다.
3. 실행:

```powershell
npm install
npm run dev
```

`http://localhost:8788` 접속. API 키 없이 레이아웃만 보려면 `http://localhost:8788/?demo`.

## Cloudflare Workers 배포

### 방법 A: GitHub 연동 (Workers Builds)
1. Cloudflare 대시보드 → Workers & Pages → Create → Import a repository → 이 저장소 선택.
2. 프로젝트(Worker) 이름은 `wrangler.toml`의 `name`(`maple-profile-maker`)과 같아야 합니다. 다르게 만들었다면 `wrangler.toml`의 `name`을 맞춰 주세요.
3. Build command는 비워 두고, Deploy command는 기본값 `npx wrangler deploy`를 그대로 씁니다.
4. Worker → Settings → Variables and Secrets에 `NEXON_API_KEY`를 **Secret**으로 추가합니다(일반 텍스트 변수는 배포 때 덮어써질 수 있음).
5. 이후 `main`에 push하면 자동 배포됩니다.

### 방법 B: CLI 직접 배포
```powershell
npx wrangler login
```
```powershell
npx wrangler secret put NEXON_API_KEY
```
```powershell
npm run deploy
```

### 참고
- 개발 단계 키는 초당 5회 / 일 1,000회 제한이 있습니다. 한 번 조회에 API 4회를 쓰며, 결과는 엣지에서 10분(이미지는 1시간) 캐시합니다. 실제 서비스 URL이 생기면 넥슨 개발자센터에서 서비스 단계 키를 새로 받아 교체하세요.
- 데이터 출처 표기: "Data based on NEXON Open API".
