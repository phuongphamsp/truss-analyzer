# Plan: Canada (CAN) support for the SST Hanger Selector integration

Branch: `feature/can-hanger-selector` (from `DataBridge-Poc1`)
Scope: Truss (Flush Bottom) only — the only connection type this app uses.

## 1. Findings

### 1.1 What the real Hanger Selector sends for CAN
Captured from `app.strongtie.com/hs/can` (Truss, Flush Bottom) — same endpoint as US
(`POST https://api.strongtie.com/gws/hanger-selector/hangers`, `SST_API_URL` unchanged):

```json
{ "style":0, "buildingCode":41, "concealed":0, "fastenerType":1000, "sort":0, "ledger":0,
  "designInformations": { "downloadDurationType":100, "upliftLoadDurationType":115 },
  "filters": { "depth":0,"model":"","series":"","webStiffeners":0,"width":0 },
  "carryingMember": { "material":5,"width":1.5,"depth":5.5,"topChord":0,"topChordPly":0,"kingWidth":0,"kingHeight":24,"ply":1 },
  "carriedMembers": [ { "material":5,"width":1.5,"depth":5.5,"ply":1,"loads":{"load":0,"uplift":0},
                        "angle":{"skewAngle":0,"skewType":0,"slopeAngle":0,"slopeType":0} } ],
  "ansitpi":0, "flushOption":"BOTTOM" }
```

The payload shape is identical to US. Only values change.

### 1.2 Field-by-field difference (US vs CAN)

| Payload field | Current (US) code | CAN value | Where in code |
|---|---|---|---|
| `buildingCode` | `BUILDING_CODE_IRC2018 = 20` hard-coded | **41** observed (API accepts CA codes 40–42 per `BuildingCodeMapper.cs`) | `sst-mapper.ts` `buildSSTPayload`, `sst-types.ts` |
| `ansitpi` | computed 3 (End) / 6 (Interior) by `computeAnsitpi` | **always 0**. UI hides the field for CAN; the official app also sends 0 | `sst-mapper.ts` |
| `downloadDurationType` | 90/100/115/125/160 from `dolFactorToDownloadDuration` | **always 100** (only "Standard Term 1.00" exists) | `sst-mapper.ts` |
| `upliftLoadDurationType` | 100 or 160 | **100** (Standard Term) or **115** (Short Term, default). Wind/seismic -> 115 | `sst-mapper.ts` |
| Species -> `material` | DF 5, HF 6, SP 7, SPF 8 | Only **DF 5 and SPF 8** are offered by the CAN selector. HF/SP do not exist for CAN | `speciesStringToMaterial` |
| Carried Download/Uplift labels | "(ASD)" | "(LSD)" | `HangerPanel.tsx`, `SSTWorkspace.tsx` labels |
| Label tables | `CODE_LABELS`, `DL_DUR_LABELS`, `UL_DUR_LABELS`, `ANSITPI_LABELS` are US-only | need CAN variants | `HangerPanel.tsx:255-266`, `SSTWorkspace.tsx:57` |

Unchanged: endpoint, response parsing (`lstHangerOutput`), geometry (skew, slope, king post, heel height, ply),
hanger style / fastener lists, member-type lists.

### 1.3 Decisions (resolved open questions)
1. CAN `buildingCode` default = **41**.
2. `fastenerType` stays **0 (All)**, as the app sends today.
3. Load units: **assume only the labels change** (ASD -> LSD); no numeric conversion for now. Revisit if the structural owner says TRE reactions need conversion.
4. Country is an **explicit UI toggle** in the header, default USA (persisted in localStorage).
5. HF / SP lumber while CAN is selected: **block** the hanger lookup (no API call) and show the reason.

## 2. Design

Introduce a single `Region = 'us' | 'can'` and a per-region config object; no `if (country === ...)` scattered in components.

```ts
// sst-types.ts (new)
export type SSTRegion = 'us' | 'can';
export interface SSTRegionConfig {
  buildingCode: number;
  usesAnsitpi: boolean;
  allowedSpecies: number[];          // SST material codes
  downloadDurations: number[];       // allowed values
  uplift: { normal: number; windQuake: number };
  loadLabelSuffix: 'ASD' | 'LSD';
  codeLabels / durationLabels: Record<number,string>;
}
export const REGION_CONFIG: Record<SSTRegion, SSTRegionConfig> = { us: {...current values...}, can: {...} };
```

`buildSSTPayload(group, carried, region = 'us')` reads `REGION_CONFIG[region]`. Default `'us'` keeps every existing call site and test behaving exactly as today.

## 3. Implementation steps (each independently committable)

1. **Region config** — add `SSTRegion`, `REGION_CONFIG` (US values = current constants, CAN values from section 1.2) in `src/lib/sst-types.ts`. No behaviour change.
2. **Payload builder** — thread `region` through `buildSSTPayload`, `buildBatchPayloads`, `computeAnsitpi` callers in `src/lib/sst-mapper.ts`:
   - `buildingCode` from config
   - `ansitpi` = 0 when `!usesAnsitpi`
   - download duration: clamp to `downloadDurations` (CAN -> 100)
   - uplift duration: CAN -> 115 if `dolFactor >= 1.33`, else 100
   - species: if material not in `allowedSpecies`, record a warning (see open Q5) instead of silently sending an invalid value
3. **State** — add `region` state (default `'us'`) in `src/App.tsx`, persist in `localStorage` like the SST token; pass to `HangerPanel`, `SSTWorkspace`, `JobSummaryTable` (all three call `buildSSTPayload`).
4. **UI** — a USA/CAN selector in the header; in both panels use `REGION_CONFIG[region]` for labels (`CODE_LABELS`, `DL_DUR_LABELS`, `UL_DUR_LABELS`), hide the ANSI/TPI row for CAN, change "(ASD)" to "(LSD)" wording, replace the hard-coded `sourceNote="IRC 2018"`.
5. **Species block** — implemented via `getRegionIssues` (HF/SP blocked in CAN) in `SSTWorkspace` and `JobSummaryTable`.
6. **Export** — `ExportTab.tsx` / job summary: include region, building code and LSD/ASD in CSV so results are traceable.
7. **Docs** — update `README.md` and add a short `docs/` note on the region differences.

## 4. Verification

- Unit tests (add vitest, repo has none today): `buildSSTPayload` with `region='us'` must produce a payload identical to current output (snapshot on `Test3/*.tre` fixtures); with `'can'` must match the captured payload in 1.1 for the same inputs (`buildingCode 41`, `ansitpi 0`, durations 100/115, `material` 5 or 8).
- Manual: run the app with a fresh token; for the same girder/carried truss, compare the hanger list from this app (CAN) with `app.strongtie.com/hs/can` entering identical inputs (Truss, Flush Bottom, DF, Standard Term / Short Term). The model list and capacities must match.
- Regression: USA flow unchanged (default region).
- `npm run build` passes (type-check).

## 5. Risks

- Wrong load units (ASD vs LSD) would give plausible-looking but unsafe results — treat open Q3 as a blocker.
- SST token is shared across regions (same API host), so no auth change is expected, but confirm with a CAN call after token refresh.
- The 3 UI components duplicate label tables; step 4 should remove the duplication rather than add a CAN copy of each.
