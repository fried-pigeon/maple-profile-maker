# 메이플 프사 생성기

메이플스토리 캐릭터 이름을 넣으면 **카카오톡 프로필 사진용 캐릭터 카드**(1080×1080 PNG)를 만들어 주는 웹사이트입니다.
캐릭터 정보와 외형 이미지는 [NEXON Open API](https://openapi.nexon.com/)에서 가져오며, API 키는 Cloudflare Worker에만 보관합니다.

- 배포 주소: https://maple-profile-maker.peune.workers.dev
- 데이터 출처: Data based on NEXON Open API

## 카드 레이아웃

카카오톡은 프로필 이미지를 자르지 않고 **이미지 전체**를 아이콘으로 쓰되, 네 변에 닿는 둥근 사각형(superellipse, `|x|^2.5 + |y|^2.5 = r^2.5`) 마스크를 씌웁니다. 실제 카톡 화면 캡처에서 아이콘 테두리를 측정해 얻은 값이며, 이 마스크 밖으로 나가는 부분은 **네 모서리뿐**입니다. 카드는 이 사실을 기준으로 배치되어 있습니다.

```
┌──────────────────────────────────────┐
│ WORLD               ✦ 1차 해방        │  ← 모서리: 아이콘에서는 가려지고
│ 스카니아      [ 캐릭터 이름 ]   데스티니  │     프로필을 크게 볼 때만 보임
│        ╭────────────────────╮        │
│        │                    │        │
│        │    캐릭터 흉상       │        │  ← 중앙: 아이콘에서 가장 크게 보이는 영역
│        │  (얼굴 + 상체)      │        │
│        │                    │        │
│        ╰────────────────────╯        │
│ GUILD        [ Lv.300 직업 ]   전투력 │
│ 길드명                       9억 2238만│
└──────────────────────────────────────┘
```

| 위치 | 내용 | 카톡 아이콘에서 |
| --- | --- | --- |
| 중앙 | 캐릭터 흉상 (얼굴 + 상체) | 보임 |
| 위 가운데 | 캐릭터 이름 | 보임 |
| 아래 가운데 | 레벨 + 직업 | 보임 |
| 왼쪽 위 | 월드 | 가려짐 |
| 오른쪽 위 | 해방 단계 (제네시스 / 데스티니 1차 해방 / 데스티니 2차 초월) | 가려짐 |
| 왼쪽 아래 | 길드 | 가려짐 |
| 오른쪽 아래 | 전투력 (억/만 단위) | 가려짐 |

- 표시 항목은 고정입니다. 값이 없으면(예: 길드 없음) 그 칸만 비우고 다른 항목을 옮기지 않습니다.
- 모서리 칸은 마스크 밖에 완전히 들어가도록 크기를 계산합니다(`maxCornerWidth`, 현재 최대 폭 158px). 글자가 길면 글꼴을 줄입니다.
- 이름·레벨/직업 칸은 마스크 안쪽에 들어오도록 최대 폭을 카드의 42%로 제한합니다.

### 흉상 자동 맞춤

캐릭터 외형 이미지는 300×300이며 발 위치가 거의 일정합니다(y≈200). 자동 맞춤은 다음 순서로 동작합니다.

1. 불투명 픽셀(알파 > 200)로 발 위치와 머리 끝을 찾습니다. 옅은 이펙트는 무시합니다.
2. 기준 키를 66~74px로 제한합니다. 큰 모자·우산·귀 장식 때문에 얼굴이 작아지거나 아래로 밀리지 않게 하기 위해서이며, 대신 큰 모자 윗부분은 잘릴 수 있습니다.
3. 얼굴 높이 구간의 불투명 픽셀 x좌표 **중앙값**으로 가로 중심을 잡습니다. 무기가 있어도 얼굴이 가운데에 옵니다.
4. 캐릭터 위쪽 80%(얼굴 + 상체)가 중앙 영역의 90%를 채우도록 **정수 배율**로 확대합니다. 도트가 흐려지지 않습니다.

사용자는 미리보기를 드래그해 위치를, 휠이나 슬라이더로 배율을 직접 조절할 수 있습니다.

### 편집 옵션

- 테마 7종(밝은 계열), 사진 틀(둥근 사각 / 원형)
- 포즈, 표정, 무기 숨기기, 좌우 반전
- 미리보기 드래그로 위치 이동, 휠·슬라이더로 배율 조절, 흉상 자동 맞춤
- PNG 저장, 모바일에서는 공유하기

## API 변화에 대한 대비(fallback) 정책

넥슨 API에 필드가 추가되거나 기존 필드에 새 값이 나와도 사이트가 멈추지 않도록, 서버(`src/api/character.js`)에서 **필요한 필드만 골라 정규화**한 뒤 클라이언트에 넘깁니다.

| 상황 | 동작 |
| --- | --- |
| 새 필드 추가 | 읽지 않으므로 영향 없음 |
| 필드 이름 변경·삭제, 빈 값 | 해당 값은 `null` → 카드에서 그 칸만 비움(이름은 검색어로, 레벨은 `Lv.?`로 대체) |
| 숫자 필드가 문자열로 오거나 형식이 바뀜 (`"1,234"` 등) | 숫자만 추려 해석, 해석 불가면 칸을 비움 |
| `liberation_quest_clear`에 처음 보는 값 (예: `"4"`) | 회색 범용 뱃지("✦ 해방 / 4단계")로 표시하고 Worker 로그에 경고 남김 |
| 전투력(`character/stat`) 조회 실패 | 전투력 칸만 비우고 나머지는 정상 표시 |
| 캐릭터 이미지 주소 없음 / 이미지 로드 실패 | 글자 정보만 있는 카드를 그리고 상태 줄에 이유 표시 |
| 넥슨 응답이 JSON이 아님 (점검 페이지 등) | "응답 형식이 올바르지 않습니다" 오류(502) |
| 처음 보는 오류 코드 | "알 수 없는 오류" 안내, HTTP 상태는 그대로 전달 |
| 존재하지 않는 캐릭터 (`OPENAPI00004`로 응답됨) | "캐릭터를 찾을 수 없습니다"(404) |
| 요청 한도 초과(429) / 서버 오류(5xx) | 최대 2회 재시도 후 오류 안내 |

해방 값 매핑: `0` 없음, `1` 제네시스 해방, `2` 데스티니 1차 해방, `3` 데스티니 2차 초월.
새 단계가 생기면 Cloudflare 대시보드 → Worker → Observability 로그에서 `unknown liberation_quest_clear value` 경고를 확인한 뒤, `src/api/character.js`의 `LIBERATION`과 `public/card.js`의 `LIBERATION_TAG`/`LIBERATION_STYLE`에 추가하면 됩니다.

## 구조

```
public/                 정적 사이트 (Workers Static Assets로 제공)
  index.html            화면
  app.js                검색, 편집 UI, 내보내기
  card.js               카드 렌더러, 흉상 자동 맞춤, 카톡 마스크 상수
  style.css
  favicon.svg, favicon-32.png, apple-touch-icon.png
src/worker.js           Worker 진입점: /api/* 라우팅, 나머지는 정적 파일
src/api/
  character.js          GET /api/character?name=  → ocid 조회 + basic/stat을 정규화해 반환
  image.js              GET /api/image?url=&action=&emotion=&wmotion=  → 캐릭터 외형 이미지 프록시
src/nexon.js            넥슨 API 호출, 오류 메시지, 재시도, 엣지 캐시 헬퍼
wrangler.toml           Worker 설정 (name, main, assets)
```

`/api/image`는 같은 출처에서 이미지를 내려주기 위한 프록시입니다. 브라우저 캔버스가 픽셀을 읽어(자동 맞춤) PNG로 저장하려면 필요하며, `open.api.nexon.com/static/maplestory/character/look/` 주소만 허용합니다.

## 로컬 실행

1. [NEXON Open API](https://openapi.nexon.com/)에서 메이플스토리 애플리케이션을 등록하고 API 키를 발급받습니다.
2. `.dev.vars.example`을 `.dev.vars`로 복사하고 키를 넣습니다(`.dev.vars`는 git에서 제외됨).
3. 실행:

```powershell
npm install
```
```powershell
npm run dev
```

`http://localhost:8788` 접속. API 키 없이 레이아웃만 보려면 `http://localhost:8788/?demo`.

## Cloudflare Workers 배포

### 방법 A: GitHub 연동 (Workers Builds, 현재 사용 중)
1. Cloudflare 대시보드 → Workers & Pages → Create → Import a repository → 이 저장소 선택.
2. Worker 이름은 `wrangler.toml`의 `name`(`maple-profile-maker`)과 같아야 합니다.
3. Build command는 비워 두고, Deploy command는 기본값 `npx wrangler deploy`를 씁니다.
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
- 개발 단계 키는 초당 5회 / 일 1,000회 제한이 있습니다. 한 번 조회에 API 3회(ocid, basic, stat)를 쓰며, 결과는 엣지에서 10분(이미지는 1시간) 캐시합니다. 공개 서비스로 쓰려면 넥슨 개발자센터에서 배포 주소로 서비스 단계 키를 새로 받아 교체하세요.
- 넥슨 Open API 데이터는 30일 이내 갱신 의무가 있습니다. 이 사이트는 조회 결과를 저장하지 않고 캐시도 최대 1시간입니다.
