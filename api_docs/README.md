# API 기술문서 ↔ API 연결표

- 작성일: 2026-11-12
- 인증키: 공공데이터포털 개인 키 1개로 5개 API 모두 호출 가능 (`DATA_GO_KR_API_KEY` Windows 사용자 환경변수 = `realestate-vworld` `.env`의 `MOLIT_SERVICE_KEY`, 같은 값)
- 키 값은 이 문서·코드에 쓰지 않는다. 코드에서는 `os.environ.get("DATA_GO_KR_API_KEY")`로 읽는다.

## 연결 점검 결과 (2026-11-12 실제 호출)

| # | API | 기술문서 | 결과 | 시험 조건 → 건수 |
|---|---|---|---|---|
| ⓪ | 행정안전부 행정표준코드 법정동코드 | [기술문서_행정안전부_행정표준코드_법정동코드.docx](기술문서_행정안전부_행정표준코드_법정동코드.docx) | 정상 (`INFO-0`) | 부산광역시 수영구 → 6건 |
| ① | 국토교통부 아파트 분양권전매 실거래가 | [아파트 분양권전매 실거래가 자료 기술문서.hwp](아파트%20분양권전매%20실거래가%20자료%20기술문서.hwp) | 정상 (`000 OK`) | 수영구(26500) 2026-09 계약 → 16건 |
| ② | 국토교통부 아파트 전월세 실거래가 | [아파트 전월세 실거래가 자료 기술문서.hwp](아파트%20전월세%20실거래가%20자료%20기술문서.hwp) | 정상 (`000 OK`) | 수영구(26500) 2026-09 계약 → 205건 |
| ③ | 한국부동산원 청약홈 분양정보 조회 | [기술문서_청약홈 분양정보 조회 서비스_260129.docx](기술문서_청약홈%20분양정보%20조회%20서비스_260129.docx) | 정상 (HTTP 200) | APT 상세 2,935건 / 주택형별 15,013건 / 잔여세대 1,749건 (전국) |
| ④ | 한국부동산원 청약홈 경쟁률·특별공급 신청현황 | [기술문서_청약홈 청약접수 경쟁률 및 특별공급 신청현황 조회 서비스_241203.docx](기술문서_청약홈%20청약접수%20경쟁률%20및%20특별공급%20신청현황%20조회%20서비스_241203.docx) | 정상 (HTTP 200) | APT 경쟁률 56,082건 (전국) |

## API별 호출 규격 (기술문서 발췌)

### ⓪ 법정동코드 — 사업대상지 → 법정동코드(앞 5자리 = 실거래 `LAWD_CD`)
- 요청: `https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList`
- 필수: `ServiceKey`(대문자 S), `type`(xml·json), `pageNo`, `numOfRows`, `flag=Y`
- 선택: `locatadd_nm`(지역주소명, 한글은 UTF-8 인코딩)

### ① 분양권전매 실거래가 — 인근 분양권 웃돈·마이너스 거래
- 요청: `https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade`
- 필수: `serviceKey`, `LAWD_CD`(5자리), `DEAL_YMD`(계약년월 6자리)
- 선택: `pageNo`, `numOfRows` · 응답 XML

### ② 아파트 전월세 실거래가 — 전세가로 본 잔금 여력
- 요청: `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`
- 필수: `serviceKey`, `LAWD_CD`, `DEAL_YMD` · 선택: `pageNo`, `numOfRows` · 응답 XML

### ③ 청약홈 분양정보 — 인근 신규 공급 평당 분양가·잔여세대(미계약 신호)
- 요청: `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/{오퍼레이션}?page=1&perPage=10&serviceKey=…`
- 오퍼레이션 10종 중 주로 쓰는 것:
  - `getAPTLttotPblancDetail` APT 분양정보 상세
  - `getAPTLttotPblancMdl` APT 주택형별 상세 (공급금액은 **분양최고금액** — 평균보다 높음)
  - `getRemndrLttotPblancDetail` / `getRemndrLttotPblancMdl` APT 잔여세대
- 조건 검색: `cond[필드::EQ]` 형식 (예: `cond[SUBSCRPT_AREA_CODE::EQ]=600` 부산). 지역코드는 기술문서 코드표 참조
- 응답 JSON

### ④ 청약홈 경쟁률 — 1·2순위 미달 주택형
- 요청: `https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/{오퍼레이션}?page=1&perPage=10&serviceKey=…`
- 오퍼레이션: `getAPTLttotPblancCmpet`(APT 경쟁률), `getRemndrLttotPblancCmpet`(잔여세대), `getCancResplLttotPblancCmpet`(취소후재공급), `getPblPvtRentLttotPblancCmpet`(공공지원 민간임대), `getOPTLttotPblancCmpet`(임의공급), `getAPTLttotPblancScore`(당첨가점)
- 주의: 경쟁률은 **계약률이 아니다**
- 응답 JSON

## 이미 연결된 도구 (직접 호출 대신 쓸 수 있는 것)

도구 이름과 설명으로 대응시킨 것이다. 각 도구가 내부에서 위 엔드포인트를 그대로 부르는지는 확인하지 않았다.

| API | Claude에서 쓰는 도구 |
|---|---|
| ⓪ 법정동코드 | `real-estate` MCP `get_region_code` |
| ① 분양권전매 | `realestate-vworld` MCP `rtms_search_presale_right_transactions` |
| ② 아파트 전월세 | `real-estate` MCP `get_apartment_rent` |
| ③ 청약홈 분양정보 | `real-estate` MCP `get_apt_subscription_info` |
| ④ 청약홈 경쟁률 | `real-estate` MCP `get_apt_subscription_results` |

## 주의
- 인천 서구는 2026-07-01 서해구·검단구로 개편됐다. 청라 등 개편 지역은 법정동코드가 바뀌므로, 실거래 조회 때 개편 전 코드(서구)와 개편 후 코드를 둘 다 확인한다.
- 실거래 `DEAL_YMD`는 계약일 기준이다. 신고 기한(계약 후 30일)이 지나지 않은 최근 달은 건수가 적게 나온다.
