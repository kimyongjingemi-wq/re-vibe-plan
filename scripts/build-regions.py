"""시군구 코드표 만들기 — 행정안전부 법정동코드 전체자료(탭 구분: 법정동코드 · 법정동명 · 폐지여부)에서
'존재'하는 시군구 줄만 골라 lib/regions-data.ts로 쓴다.

왜: 공공데이터포털 법정동코드 API가 초당 요청 제한(HTTP 429)에 자주 걸려 사업계획서 조회 전체가 막혔다.
시군구 코드는 거의 바뀌지 않으므로 앱 안에 표로 넣고, 행정구역이 바뀌면 이 스크립트를 다시 돌린다.

실행: C:\\workspace\\venv\\Scripts\\python.exe -X utf8 scripts\\build-regions.py <법정동코드 파일> <기준일 YYYY-MM-DD>
"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
src = Path(sys.argv[1])
as_of = sys.argv[2]
out = Path(__file__).resolve().parent.parent / "lib" / "regions-data.ts"

rows = []
for line in src.read_text(encoding="utf-8").splitlines()[1:]:
    parts = line.split("\t")
    if len(parts) < 3:
        continue
    code, name, status = parts[0].strip(), " ".join(parts[1].split()), parts[2].strip()
    # 시군구 줄: 시도(뒤 8자리 0) 제외, 읍면동 · 리(뒤 5자리가 0이 아님) 제외, 폐지 제외
    if status != "존재" or len(code) != 10 or code[2:5] == "000" or code[5:] != "00000":
        continue
    rows.append((code[:5], name))

rows.sort()
body = ",\n".join(f"  [{json.dumps(c)}, {json.dumps(n, ensure_ascii=False)}]" for c, n in rows)
out.write_text(
    "// 자동 생성 파일 — 손으로 고치지 말 것. scripts/build-regions.py로 다시 만든다.\n"
    f"// 출처: 행정안전부 법정동코드 전체자료 · 기준 {as_of} · '존재' 시군구 {len(rows)}개\n\n"
    f'export const REGIONS_AS_OF = "{as_of}";\n'
    f'export const REGIONS_SOURCE = "행정안전부 법정동코드 전체자료";\n\n'
    "/** [시군구 코드 5자리, 시군구 전체 이름] */\n"
    f"export const SGG_ROWS: [string, string][] = [\n{body},\n];\n",
    encoding="utf-8",
)
print(f"시군구 {len(rows)}개 → {out}")
