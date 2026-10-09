# 장비 그림 프롬프트 시트 (기획 15차)

> 원정 모드 장비 그림 52장을 이미지 생성기로 만들기 위한 시트입니다. 규칙은 `docs/expedition.md` 9장.
> 그림이 없어도 게임은 코드 그림으로 돌아갑니다. 파일을 하나씩 넣으면 그것만 바뀝니다.

## 1. 한눈에

- 필요한 그림: **52장** = 무기 36(무기 모양 9가지 × 묶음 4) + 방어구 4 + 장신구 4 + 유물 8.
- 만들 크기: **1024×1024, 배경 투명 PNG**. 원본은 `art/gear/`에 보관(게임에 안 들어감).
- 게임에 넣는 파일: **256×256 투명 PNG, 1장 60KB 이하, 52장 합계 3.5MB 이하**. 넣는 곳 **`src/assets/gear/`**.
  - `npm run art:gear`를 돌리면 `art/gear/`의 원본을 256으로 줄여서 `src/assets/gear/`에 넣어 줍니다. 256×256 파일을 직접 넣어도 됩니다.
- 파일 이름이 목록과 똑같아야 자동으로 바뀝니다(소문자, `.png`).
- 메뉴(보관함·장비 화면·전리품 카드)에 쓰입니다. 전투 화면 손의 무기는 기본이 코드 그림이고, 디버그 「장비 그림: 코드 / 파일」로 비교해 볼 수 있습니다.

## 2. 묶음(등급) 4개

| 묶음 | 등급 | 이름 | 색 | 느낌 |
|---|---|---|---|---|
| b1 | T1~3 | 낡은 | 회색 #ADB5BD | 주워 온 것. 긁힌 쇠, 금 간 나무, 헤진 천 테이프. 빛 없음 |
| b2 | T4~6 | 강화 | 하늘 #4CC9F0 | 깔끔한 강철, 리벳, 하늘색 테두리 빛 |
| b3 | T7~9 | 퇴마 | 보라 #C77DFF | 흰 자기·은, 상아색 부적 띠(가는 붉은 먹선), 보라 영혼 빛, 작은 불꽃 |
| b4 | T10~12 | 심연 | 금 #FFD166 | 검은 흑요석, 금 장식, 보라·금 눈 하나, 강한 금빛, 도는 입자 |

- 유물은 묶음 없이 1장씩입니다. 등급(T3/T6/T9/T12)은 게임이 테두리 색으로 보여 줍니다.

## 3. 공통 스타일 (모든 그림에 똑같이, 영어 그대로)

```
Game item icon for a mobile auto-battler with a Korean urban-horror (ghost story) theme. Bold clean cartoon style, chunky rounded proportions, thick uniform dark navy outline (#141824), flat colors with one cel-shade tone and one crisp top-left highlight, high contrast, readable as a silhouette at 48 px. Single object only, centered, filling about 80% of the canvas, slight 3/4 view. Fully transparent background, no ground shadow, no frame, no text, no letters, no numbers, no watermark, no hands or characters. Not photorealistic, not 3D-rendered, no painterly texture. Avoid red as a main color.
```

묶음 문구:
```
b1: Tier 'Worn': improvised worn materials - scratched dull iron, cracked wood, frayed cloth tape; muted gray-brown palette with gray accent #ADB5BD; no glow, no particles.
b2: Tier 'Reinforced': clean polished steel and dark polymer, neat rivets and straps; cool steel palette with bright cyan accent trim #4CC9F0; thin cyan rim light; no particles.
b3: Tier 'Exorcist': white porcelain and silver with ivory paper talisman strips marked by thin red ink lines; violet accent #C77DFF; soft violet spirit glow around the edges and two or three tiny floating sparks.
b4: Tier 'Abyssal': glossy black obsidian with ornate gold filigree #FFD166; a single glowing violet-and-gold eye motif set into the object; strong golden aura glow and a few small orbiting particles.
relic: Legendary relic: ancient and uncanny, thin gold rim accents, soft magical aura in <aura>, slightly floating. No tier colors other than the aura.
```

- 조립: **스타일 + " Subject: " + 대상 + " " + 묶음 문구**. 유물은 묶음 문구 대신 relic 문구(`<aura>`에 그 유물의 색).
- 긴 무기(검·도끼·활·지팡이·망치)에는 대상 뒤에 `Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.`가 붙어 있습니다. 나중에 전투 손 그림으로도 쓸 수 있게 하는 구도입니다(손잡이가 그림의 왼쪽 아래 약 28%, 72% 자리).
- 방패·오브·류트·총은 똑바로 세운 구도 그대로.

## 4. 만드는 순서

1. **스타일 기준 4장 먼저**: 검 b1~b4(아래 5절). 네 장이 같은 화풍인지, 묶음 차이가 한눈에 보이는지, 48px로 줄여도 모양이 읽히는지 확인.
2. 괜찮으면 나머지 48장을 같은 문구로. 생성기가 참고 이미지를 받으면 검 4장을 같이 넣기.
3. 원본을 `art/gear/`에 저장 → `npm run art:gear` → 게임에서 확인(보관함, 장비 화면).
4. 맘에 안 드는 것만 다시 만들어 같은 이름으로 덮어쓰기.

확인할 것: 배경이 정말 투명한지(체크무늬가 그림에 그려지면 안 됨), 글자·숫자·손이 없는지, 빨강이 주색이 아닌지, 가운데 꽉 차게(약 80%).

## 5. 스타일 기준 프롬프트 (바로 붙여 넣기)

**gear-weapon-sword-b1.png** (녹슨 장검)
```
Game item icon for a mobile auto-battler with a Korean urban-horror (ghost story) theme. Bold clean cartoon style, chunky rounded proportions, thick uniform dark navy outline (#141824), flat colors with one cel-shade tone and one crisp top-left highlight, high contrast, readable as a silhouette at 48 px. Single object only, centered, filling about 80% of the canvas, slight 3/4 view. Fully transparent background, no ground shadow, no frame, no text, no letters, no numbers, no watermark, no hands or characters. Not photorealistic, not 3D-rendered, no painterly texture. Avoid red as a main color. Subject: a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees. Tier 'Worn': improvised worn materials - scratched dull iron, cracked wood, frayed cloth tape; muted gray-brown palette with gray accent #ADB5BD; no glow, no particles.
```

**gear-weapon-sword-b2.png** (강화 강철검)
```
Game item icon for a mobile auto-battler with a Korean urban-horror (ghost story) theme. Bold clean cartoon style, chunky rounded proportions, thick uniform dark navy outline (#141824), flat colors with one cel-shade tone and one crisp top-left highlight, high contrast, readable as a silhouette at 48 px. Single object only, centered, filling about 80% of the canvas, slight 3/4 view. Fully transparent background, no ground shadow, no frame, no text, no letters, no numbers, no watermark, no hands or characters. Not photorealistic, not 3D-rendered, no painterly texture. Avoid red as a main color. Subject: a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees. Tier 'Reinforced': clean polished steel and dark polymer, neat rivets and straps; cool steel palette with bright cyan accent trim #4CC9F0; thin cyan rim light; no particles.
```

**gear-weapon-sword-b3.png** (퇴마 은검)
```
Game item icon for a mobile auto-battler with a Korean urban-horror (ghost story) theme. Bold clean cartoon style, chunky rounded proportions, thick uniform dark navy outline (#141824), flat colors with one cel-shade tone and one crisp top-left highlight, high contrast, readable as a silhouette at 48 px. Single object only, centered, filling about 80% of the canvas, slight 3/4 view. Fully transparent background, no ground shadow, no frame, no text, no letters, no numbers, no watermark, no hands or characters. Not photorealistic, not 3D-rendered, no painterly texture. Avoid red as a main color. Subject: a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees. Tier 'Exorcist': white porcelain and silver with ivory paper talisman strips marked by thin red ink lines; violet accent #C77DFF; soft violet spirit glow around the edges and two or three tiny floating sparks.
```

**gear-weapon-sword-b4.png** (심연의 검)
```
Game item icon for a mobile auto-battler with a Korean urban-horror (ghost story) theme. Bold clean cartoon style, chunky rounded proportions, thick uniform dark navy outline (#141824), flat colors with one cel-shade tone and one crisp top-left highlight, high contrast, readable as a silhouette at 48 px. Single object only, centered, filling about 80% of the canvas, slight 3/4 view. Fully transparent background, no ground shadow, no frame, no text, no letters, no numbers, no watermark, no hands or characters. Not photorealistic, not 3D-rendered, no painterly texture. Avoid red as a main color. Subject: a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees. Tier 'Abyssal': glossy black obsidian with ornate gold filigree #FFD166; a single glowing violet-and-gold eye motif set into the object; strong golden aura glow and a few small orbiting particles.
```

## 6. 전체 목록 (52장)

| # | 칸 | 파일 이름 | 한글 이름 | 비고 |
|---|---|---|---|---|
| 1 | 무기 | `gear-weapon-shield-b1.png` | 낡은 철판 방패 | 방패 (가디언·워든) · 묶음 1 |
| 2 | 무기 | `gear-weapon-shield-b2.png` | 강화 진압 방패 | 방패 (가디언·워든) · 묶음 2 |
| 3 | 무기 | `gear-weapon-shield-b3.png` | 퇴마 부적 방패 | 방패 (가디언·워든) · 묶음 3 |
| 4 | 무기 | `gear-weapon-shield-b4.png` | 심연의 눈 방패 | 방패 (가디언·워든) · 묶음 4 |
| 5 | 무기 | `gear-weapon-sword-b1.png` | 녹슨 장검 | 검 (블레이드·섀도우) · 묶음 1 |
| 6 | 무기 | `gear-weapon-sword-b2.png` | 강화 강철검 | 검 (블레이드·섀도우) · 묶음 2 |
| 7 | 무기 | `gear-weapon-sword-b3.png` | 퇴마 은검 | 검 (블레이드·섀도우) · 묶음 3 |
| 8 | 무기 | `gear-weapon-sword-b4.png` | 심연의 검 | 검 (블레이드·섀도우) · 묶음 4 |
| 9 | 무기 | `gear-weapon-axe-b1.png` | 낡은 소방 도끼 | 도끼 (버서커) · 묶음 1 |
| 10 | 무기 | `gear-weapon-axe-b2.png` | 강화 전투 도끼 | 도끼 (버서커) · 묶음 2 |
| 11 | 무기 | `gear-weapon-axe-b3.png` | 퇴마 도끼 | 도끼 (버서커) · 묶음 3 |
| 12 | 무기 | `gear-weapon-axe-b4.png` | 심연의 도끼 | 도끼 (버서커) · 묶음 4 |
| 13 | 무기 | `gear-weapon-bow-b1.png` | 낡은 나무 활 | 활 (레인저) · 묶음 1 |
| 14 | 무기 | `gear-weapon-bow-b2.png` | 강화 합성궁 | 활 (레인저) · 묶음 2 |
| 15 | 무기 | `gear-weapon-bow-b3.png` | 퇴마 신궁 | 활 (레인저) · 묶음 3 |
| 16 | 무기 | `gear-weapon-bow-b4.png` | 심연의 활 | 활 (레인저) · 묶음 4 |
| 17 | 무기 | `gear-weapon-orb-b1.png` | 금 간 유리구슬 | 오브 (메이지·크로노·퍼펫티어) · 묶음 1 |
| 18 | 무기 | `gear-weapon-orb-b2.png` | 강화 수정구 | 오브 (메이지·크로노·퍼펫티어) · 묶음 2 |
| 19 | 무기 | `gear-weapon-orb-b3.png` | 퇴마 영혼구 | 오브 (메이지·크로노·퍼펫티어) · 묶음 3 |
| 20 | 무기 | `gear-weapon-orb-b4.png` | 심연의 눈알 구 | 오브 (메이지·크로노·퍼펫티어) · 묶음 4 |
| 21 | 무기 | `gear-weapon-staff-b1.png` | 낡은 나무 지팡이 | 지팡이 (클레릭·메딕·퇴마사) · 묶음 1 |
| 22 | 무기 | `gear-weapon-staff-b2.png` | 강화 금속 지팡이 | 지팡이 (클레릭·메딕·퇴마사) · 묶음 2 |
| 23 | 무기 | `gear-weapon-staff-b3.png` | 퇴마 방울 지팡이 | 지팡이 (클레릭·메딕·퇴마사) · 묶음 3 |
| 24 | 무기 | `gear-weapon-staff-b4.png` | 심연의 지팡이 | 지팡이 (클레릭·메딕·퇴마사) · 묶음 4 |
| 25 | 무기 | `gear-weapon-hammer-b1.png` | 낡은 공사 망치 | 망치 (팔라딘) · 묶음 1 |
| 26 | 무기 | `gear-weapon-hammer-b2.png` | 강화 전투 망치 | 망치 (팔라딘) · 묶음 2 |
| 27 | 무기 | `gear-weapon-hammer-b3.png` | 퇴마 성망치 | 망치 (팔라딘) · 묶음 3 |
| 28 | 무기 | `gear-weapon-hammer-b4.png` | 심연의 망치 | 망치 (팔라딘) · 묶음 4 |
| 29 | 무기 | `gear-weapon-gun-b1.png` | 낡은 나팔총 | 총 (거너) · 묶음 1 |
| 30 | 무기 | `gear-weapon-gun-b2.png` | 강화 산탄총 | 총 (거너) · 묶음 2 |
| 31 | 무기 | `gear-weapon-gun-b3.png` | 퇴마 은탄총 | 총 (거너) · 묶음 3 |
| 32 | 무기 | `gear-weapon-gun-b4.png` | 심연의 총 | 총 (거너) · 묶음 4 |
| 33 | 무기 | `gear-weapon-lute-b1.png` | 낡은 류트 | 류트 (바드) · 묶음 1 |
| 34 | 무기 | `gear-weapon-lute-b2.png` | 강화 류트 | 류트 (바드) · 묶음 2 |
| 35 | 무기 | `gear-weapon-lute-b3.png` | 퇴마 류트 | 류트 (바드) · 묶음 3 |
| 36 | 무기 | `gear-weapon-lute-b4.png` | 심연의 류트 | 류트 (바드) · 묶음 4 |
| 37 | 방어구 | `gear-armor-b1.png` | 낡은 작업복 조끼 | 묶음 1 |
| 38 | 방어구 | `gear-armor-b2.png` | 강화 방호 조끼 | 묶음 2 |
| 39 | 방어구 | `gear-armor-b3.png` | 퇴마 도포 갑옷 | 묶음 3 |
| 40 | 방어구 | `gear-armor-b4.png` | 심연의 갑주 | 묶음 4 |
| 41 | 장신구 | `gear-charm-b1.png` | 낡은 방울 열쇠고리 | 묶음 1 |
| 42 | 장신구 | `gear-charm-b2.png` | 강화 군번줄 | 묶음 2 |
| 43 | 장신구 | `gear-charm-b3.png` | 퇴마 부적 | 묶음 3 |
| 44 | 장신구 | `gear-charm-b4.png` | 심연의 눈 펜던트 | 묶음 4 |
| 45 | 유물 | `gear-relic-echo_seal.png` | 메아리 인장 | 오라 #90E0EF |
| 46 | 유물 | `gear-relic-relay_flag.png` | 교대의 깃발 | 오라 #FFB703 |
| 47 | 유물 | `gear-relic-vanguard_helm.png` | 선봉의 투구 | 오라 #4CC9F0 |
| 48 | 유물 | `gear-relic-hunter_mark.png` | 사냥꾼의 표식 | 오라 #A7C957 |
| 49 | 유물 | `gear-relic-phoenix_feather.png` | 불사조 깃털 | 오라 #FFD166 |
| 50 | 유물 | `gear-relic-beast_collar.png` | 야수의 목걸이 | 오라 #74C69D |
| 51 | 유물 | `gear-relic-rage_breaker.png` | 광기 사냥꾼 | 오라 #C77DFF |
| 52 | 유물 | `gear-relic-blood_chalice.png` | 흡혈의 잔 | 오라 #B388FF |

## 7. Codex 등 일괄 생성용

- 이 작업 환경에서 Codex로 만들려면: 먼저 환경 설정 → 네트워크 접근에서 `auth.openai.com`, `api.openai.com`, `chatgpt.com`을 허용해 주세요(지금은 막혀 있음). 그다음 Codex에 로그인하면 이 목록대로 한 번에 만들 수 있습니다. 로그인 정보가 작업 환경에 남으니 끝나면 로그아웃을 권합니다.
- 다른 곳(본인 Codex 등)에서 만들어도 됩니다. 파일 이름만 맞춰 `art/gear/`에 넣으면 됩니다.
- 아래 JSON: `items`마다 `prompt = style + " Subject: " + subject + " " + tiers[tier]`로 이어 붙여 만들고 `file` 이름으로 저장합니다. 유물(`tier: relic`)은 `<aura>`를 `aura` 값으로 바꿉니다.

```json
{
 "size": "1024x1024",
 "background": "transparent",
 "format": "png",
 "assemble": "prompt = style + ' Subject: ' + subject + ' ' + tiers[tier] (relic: tiers.relic with <aura> replaced by the item's aura)",
 "style": "Game item icon for a mobile auto-battler with a Korean urban-horror (ghost story) theme. Bold clean cartoon style, chunky rounded proportions, thick uniform dark navy outline (#141824), flat colors with one cel-shade tone and one crisp top-left highlight, high contrast, readable as a silhouette at 48 px. Single object only, centered, filling about 80% of the canvas, slight 3/4 view. Fully transparent background, no ground shadow, no frame, no text, no letters, no numbers, no watermark, no hands or characters. Not photorealistic, not 3D-rendered, no painterly texture. Avoid red as a main color.",
 "tiers": {"b1": "Tier 'Worn': improvised worn materials - scratched dull iron, cracked wood, frayed cloth tape; muted gray-brown palette with gray accent #ADB5BD; no glow, no particles.", "b2": "Tier 'Reinforced': clean polished steel and dark polymer, neat rivets and straps; cool steel palette with bright cyan accent trim #4CC9F0; thin cyan rim light; no particles.", "b3": "Tier 'Exorcist': white porcelain and silver with ivory paper talisman strips marked by thin red ink lines; violet accent #C77DFF; soft violet spirit glow around the edges and two or three tiny floating sparks.", "b4": "Tier 'Abyssal': glossy black obsidian with ornate gold filigree #FFD166; a single glowing violet-and-gold eye motif set into the object; strong golden aura glow and a few small orbiting particles.", "relic": "Legendary relic: ancient and uncanny, thin gold rim accents, soft magical aura in <aura>, slightly floating. No tier colors other than the aura."},
 "items": [
  {"file": "gear-weapon-shield-b1.png", "nameKo": "낡은 철판 방패", "subject": "a sturdy shield seen from the front, slightly tilted.", "tier": "b1"},
  {"file": "gear-weapon-shield-b2.png", "nameKo": "강화 진압 방패", "subject": "a sturdy shield seen from the front, slightly tilted.", "tier": "b2"},
  {"file": "gear-weapon-shield-b3.png", "nameKo": "퇴마 부적 방패", "subject": "a sturdy shield seen from the front, slightly tilted.", "tier": "b3"},
  {"file": "gear-weapon-shield-b4.png", "nameKo": "심연의 눈 방패", "subject": "a sturdy shield seen from the front, slightly tilted.", "tier": "b4"},
  {"file": "gear-weapon-sword-b1.png", "nameKo": "녹슨 장검", "subject": "a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b1"},
  {"file": "gear-weapon-sword-b2.png", "nameKo": "강화 강철검", "subject": "a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b2"},
  {"file": "gear-weapon-sword-b3.png", "nameKo": "퇴마 은검", "subject": "a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b3"},
  {"file": "gear-weapon-sword-b4.png", "nameKo": "심연의 검", "subject": "a one-handed straight sword with a simple crossguard. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b4"},
  {"file": "gear-weapon-axe-b1.png", "nameKo": "낡은 소방 도끼", "subject": "a single-bladed fire axe with a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b1"},
  {"file": "gear-weapon-axe-b2.png", "nameKo": "강화 전투 도끼", "subject": "a single-bladed fire axe with a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b2"},
  {"file": "gear-weapon-axe-b3.png", "nameKo": "퇴마 도끼", "subject": "a single-bladed fire axe with a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b3"},
  {"file": "gear-weapon-axe-b4.png", "nameKo": "심연의 도끼", "subject": "a single-bladed fire axe with a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b4"},
  {"file": "gear-weapon-bow-b1.png", "nameKo": "낡은 나무 활", "subject": "a recurve bow with its string. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b1"},
  {"file": "gear-weapon-bow-b2.png", "nameKo": "강화 합성궁", "subject": "a recurve bow with its string. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b2"},
  {"file": "gear-weapon-bow-b3.png", "nameKo": "퇴마 신궁", "subject": "a recurve bow with its string. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b3"},
  {"file": "gear-weapon-bow-b4.png", "nameKo": "심연의 활", "subject": "a recurve bow with its string. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b4"},
  {"file": "gear-weapon-orb-b1.png", "nameKo": "금 간 유리구슬", "subject": "a short wand-staff topped with a glowing orb, upright.", "tier": "b1"},
  {"file": "gear-weapon-orb-b2.png", "nameKo": "강화 수정구", "subject": "a short wand-staff topped with a glowing orb, upright.", "tier": "b2"},
  {"file": "gear-weapon-orb-b3.png", "nameKo": "퇴마 영혼구", "subject": "a short wand-staff topped with a glowing orb, upright.", "tier": "b3"},
  {"file": "gear-weapon-orb-b4.png", "nameKo": "심연의 눈알 구", "subject": "a short wand-staff topped with a glowing orb, upright.", "tier": "b4"},
  {"file": "gear-weapon-staff-b1.png", "nameKo": "낡은 나무 지팡이", "subject": "a tall staff topped with a small crossbar and a glowing bead. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b1"},
  {"file": "gear-weapon-staff-b2.png", "nameKo": "강화 금속 지팡이", "subject": "a tall staff topped with a small crossbar and a glowing bead. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b2"},
  {"file": "gear-weapon-staff-b3.png", "nameKo": "퇴마 방울 지팡이", "subject": "a tall staff topped with a small crossbar and a glowing bead, with three small shaman bells hanging from the crossbar. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b3"},
  {"file": "gear-weapon-staff-b4.png", "nameKo": "심연의 지팡이", "subject": "a tall staff topped with a small crossbar and a glowing bead. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b4"},
  {"file": "gear-weapon-hammer-b1.png", "nameKo": "낡은 공사 망치", "subject": "a war hammer with a rectangular head and a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b1"},
  {"file": "gear-weapon-hammer-b2.png", "nameKo": "강화 전투 망치", "subject": "a war hammer with a rectangular head and a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b2"},
  {"file": "gear-weapon-hammer-b3.png", "nameKo": "퇴마 성망치", "subject": "a war hammer with a rectangular head and a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b3"},
  {"file": "gear-weapon-hammer-b4.png", "nameKo": "심연의 망치", "subject": "a war hammer with a rectangular head and a long handle. Lying diagonally: handle/grip at the lower-left, tip at the upper-right, 45 degrees.", "tier": "b4"},
  {"file": "gear-weapon-gun-b1.png", "nameKo": "낡은 나팔총", "subject": "a short flared blunderbuss pistol, side view, barrel pointing right.", "tier": "b1"},
  {"file": "gear-weapon-gun-b2.png", "nameKo": "강화 산탄총", "subject": "a short flared blunderbuss pistol, side view, barrel pointing right.", "tier": "b2"},
  {"file": "gear-weapon-gun-b3.png", "nameKo": "퇴마 은탄총", "subject": "a short flared blunderbuss pistol, side view, barrel pointing right.", "tier": "b3"},
  {"file": "gear-weapon-gun-b4.png", "nameKo": "심연의 총", "subject": "a short flared blunderbuss pistol, side view, barrel pointing right.", "tier": "b4"},
  {"file": "gear-weapon-lute-b1.png", "nameKo": "낡은 류트", "subject": "a small round-bodied lute with a short neck.", "tier": "b1"},
  {"file": "gear-weapon-lute-b2.png", "nameKo": "강화 류트", "subject": "a small round-bodied lute with a short neck.", "tier": "b2"},
  {"file": "gear-weapon-lute-b3.png", "nameKo": "퇴마 류트", "subject": "a small round-bodied lute with a short neck.", "tier": "b3"},
  {"file": "gear-weapon-lute-b4.png", "nameKo": "심연의 류트", "subject": "a small round-bodied lute with a short neck.", "tier": "b4"},
  {"file": "gear-armor-b1.png", "nameKo": "낡은 작업복 조끼", "subject": "a patched canvas work vest with duct tape, front view.", "tier": "b1"},
  {"file": "gear-armor-b2.png", "nameKo": "강화 방호 조끼", "subject": "a riot-police plated vest with rounded shoulder pads, front view.", "tier": "b2"},
  {"file": "gear-armor-b3.png", "nameKo": "퇴마 도포 갑옷", "subject": "a white exorcist robe-armor with a V collar and paper talisman tabs on the shoulders, front view.", "tier": "b3"},
  {"file": "gear-armor-b4.png", "nameKo": "심연의 갑주", "subject": "a black cuirass with spiked pauldrons and a small eye on the chest, front view.", "tier": "b4"},
  {"file": "gear-charm-b1.png", "nameKo": "낡은 방울 열쇠고리", "subject": "a small brass bell keychain.", "tier": "b1"},
  {"file": "gear-charm-b2.png", "nameKo": "강화 군번줄", "subject": "a military dog tag on a ball chain.", "tier": "b2"},
  {"file": "gear-charm-b3.png", "nameKo": "퇴마 부적", "subject": "a folded Korean paper talisman (bujeok) with a red ink seal, tied with string.", "tier": "b3"},
  {"file": "gear-charm-b4.png", "nameKo": "심연의 눈 펜던트", "subject": "a floating eye pendant in a gold setting.", "tier": "b4"},
  {"file": "gear-relic-echo_seal.png", "nameKo": "메아리 인장", "subject": "a round bronze wax-seal stamp whose face shows concentric echo ripple rings.", "tier": "relic", "aura": "#90E0EF"},
  {"file": "gear-relic-relay_flag.png", "nameKo": "교대의 깃발", "subject": "a small triangular relay flag on a short baton pole, mid-wave.", "tier": "relic", "aura": "#FFB703"},
  {"file": "gear-relic-vanguard_helm.png", "nameKo": "선봉의 투구", "subject": "a compact visored vanguard helmet with a short crest.", "tier": "relic", "aura": "#4CC9F0"},
  {"file": "gear-relic-hunter_mark.png", "nameKo": "사냥꾼의 표식", "subject": "a bone token carved with a crosshair hunter's mark, on a cord.", "tier": "relic", "aura": "#A7C957"},
  {"file": "gear-relic-phoenix_feather.png", "nameKo": "불사조 깃털", "subject": "a single long glowing orange-gold phoenix feather.", "tier": "relic", "aura": "#FFD166"},
  {"file": "gear-relic-beast_collar.png", "nameKo": "야수의 목걸이", "subject": "a studded leather beast collar with a fang charm.", "tier": "relic", "aura": "#74C69D"},
  {"file": "gear-relic-rage_breaker.png", "nameKo": "광기 사냥꾼", "subject": "a heavy spiked gauntlet crushing a cracked horned skull.", "tier": "relic", "aura": "#C77DFF"},
  {"file": "gear-relic-blood_chalice.png", "nameKo": "흡혈의 잔", "subject": "an ornate silver goblet filled with dark violet liquid.", "tier": "relic", "aura": "#B388FF"}
 ]
}
```
