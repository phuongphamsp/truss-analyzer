# Truss Analyzer: Calculation Reference

How the app finds **girders** and their **carried trusses**, and how every field of the
**SST Hanger Selector input** (Connection Type, Job Settings, Girder, Truss, Hanger Options) is
determined.

- Scope: the **TRE-only** flow (no IFC file is imported), Truss (Flush Bottom) connections,
  regions **USA** and **CAN**.
- Status: reflects branch `feature/can-hanger-selector` as of commit `9a22909`.
- Where something is a tester rule that is not documented by MiTek or Simpson, it is marked
  **(tester rule)**. Where a rule is provisional it is marked **(provisional)**.

---

## 0. Overview

```
TRE files ──► parseTre() per file ──► girder detection ──► carried list per girder
                                                              │
                                    enrichCarriedTrusses()  ◄─┘  reactions + DOL per connection
                                                              │
        region toggle (USA / CAN) ──► applyRegionReactions() ─┘  region view of the reactions
                                                              │
                              buildSSTPayload()  ──►  SST Hanger Selector API
                                    │
                                    └──► the "Input" panel shows the same values
```

| Step | Code |
|---|---|
| Parse files, build girder groups | `src/lib/parser.ts` (`analyzeFiles`, `parseTre`, `analyzeConnections`) |
| Reactions and DOL | `src/lib/parser.ts` (`parseReactionAtBearing`, `enrichCarriedTrusses`), `src/lib/reactions.ts` |
| Build the API payload | `src/lib/sst-mapper.ts` (`buildSSTPayload`) |
| Region rules | `src/lib/sst-types.ts` (`REGION_CONFIG`), `src/lib/region.tsx` |
| On-screen Input panel | `src/components/SSTWorkspace.tsx` |

### Conventions used in this document

- **Block numbers.** Testers number the values of a hanger line `LGnT=...` counting `LGnT` as
  block **#1**. This document also uses `f[i]`, the 0-based index of the value after `=`.
  They are related by **block = i + 2**.

  ```
  LG2T=0 1 50 0 J10 1.5 4.206 0 1 1 33.6905 1 0 0 90 0 44 0 1 0000...-0000 0
  f[i]  0 1  2 3  4  5    6   7 8 9    10   11 12 13 14 15 16
  block #2 #3 #4 #5 #6 #7  #8  #9 #10 #11 #12 ...
  ```

- Units are inches and pounds. Y = 0 is the underside of the truss.
- "Region" means the USA / CAN toggle in the header. The default is USA and it is remembered in
  the browser.

---

## 1. Data read from a TRE file

`parseTre()` reads one `.tre` file into a `TreData` record. The **label** of a truss is its
**file name without extension, upper-case** (`cg4.tre` is `CG4`). Hanger lines refer to trusses by
that label.

| Item | Where in the TRE | Used for |
|---|---|---|
| Girder flag | `Girder=YES/NO`, `TRUSS TYPE=`, hanger section (see 2.2) | girder detection |
| Span, pitch | `ROOF BASICS`, line after it: 2nd and 3rd value | span for ANSI/TPI, bearing search |
| Members | `MEMBER INFO` (name, size, grade, species, width, depth, coordinates) | bottom chord size, species, king post |
| Cutting list | `[ADDITIONAL CUTTING INFO]` | species fallback |
| Ply | `Ply=` (first match; not `Plies on Girder`) | Number of Plies |
| Left/Right stub | `Left Stub=`, `Right Stub=` | bearing position |
| Left/Right heel | `Left Heel Height=`, `Right Heel Height=` (or `MEMBER INFO`) | heel fallback only |
| Bottom chord slopes | `Bottom Chord Slopes=` | slope fallback only |
| Summary reactions | `Reaction1/2`, `Max Uplift1/2` | reaction fallback only |
| Hangers | `[Hanger Loading Info.]` lines `LGnT=...` | the carried list and many fields |
| Load cases | `REACTION INFO` | Download, Uplift, DOL |

**Member classification** (by name prefix): `T*` top chord (not `TH*`), `B*` bottom chord (not
`BR*`), `W*` web, `PT*`/`PB*` peak, `DT*`/`DB*` dummy. A member is *structural* when its
coordinates span more than 0.5" in X or Y.

**Hanger line fields** (`f[i]`, 0-based after `=`):

| `f[i]` | Block | Meaning | Used for |
|---|---|---|---|
| `f[2]` | #4 | position along the girder = **center** of the carried truss **(tester rule)** | Offset X, ANSI/TPI, king post |
| `f[4]` | #6 | label of the carried truss | which truss is carried |
| `f[5]` | #7 | truss thickness (1.5) | not used |
| `f[6]` | #8 | **Heel Height** | Heel Height |
| `f[8]` | #10 | **1 = top chord (TC), 2 = bottom chord (BC)** hanger **(tester rule)** | separate TC / BC loads |
| `f[10]` | #12 | **signed slope angle**, positive = Down, negative = Up **(tester rule)** | Slope |
| `f[14]` | #16 | angle of the carried truss to the girder, 90 or 270 = square | Skew |
| `f[16]` | #18 | bearing location on the carried truss | find its reaction rows |

---

## 2. Part 1: Girder list and carried trusses

### 2.1 Pipeline

1. Every TRE file is parsed (`parseTre`) and stored by label.
2. Because no IFC is imported, one **instance** per TRE is created (`id = MOCK_<label>`) with the
   girder flag from the TRE. There is no 3D geometry, so no geometric matching is done.
3. For every instance flagged as girder **that has at least one hanger line**, the carried list is
   built from those hanger lines (2.3).
4. Each connection (girder + carried truss) is enriched with reactions and DOL (2.4).

### 2.2 Which trusses are girders

A truss is a girder when:

```
isGirder = (number of hanger lines > 0)  OR  ( explicit Girder= flag  ??  name/section hints )
```

1. **A truss with hanger lines is always a girder**, because it carries other trusses.
2. Otherwise the explicit flag `Girder=YES` or `Girder=NO` (first occurrence) decides.
3. Only when the file has no explicit flag, hints are used:
   - a `TRUSS TYPE=...` line containing the word "girder";
   - a line containing "girder" (other than `Girder=NO`) in `TRUSS INFO`;
   - `TRUSS TYPE=...girder` in `[ADDITIONAL TRUSS INFO]`;
   - the line right after `[Hanger Loading Info.]` having content.

The explicit flag wins over the type name on purpose. Example from job B215062: `CG1`, `CG2`,
`CG4` have `TRUSS TYPE=Diagonal Hip Girder` but `Girder=NO` and no hangers, so they are **not**
girders.

**A girder is only listed if it has hangers.** A truss flagged `Girder=YES` with no hanger lines
carries nothing and produces no group. Result for B215062: 7 girders (G1, G2, H1, H4, J1, J5, J7).

### 2.3 Which trusses are carried by a girder

The carried list of a girder is **one entry per hanger line (`LGnT`) in the girder's TRE**:

1. Take the girder's hanger lines and **sort them by position** `f[2]` (ascending).
2. For each hanger, find an instance whose label equals the hanger label (case-insensitive; if
   none, one whose label without a `-suffix` equals it). An instance is used only once.
3. If none exists, a mock instance is created (`MOCK_<label>_<random>`). This is why a truss that
   is itself a girder can also be carried (e.g. `T03` on `T01A`), and why ids in the UI are long.
4. The carried truss gets: position `localX = f[2]`, its own TRE (`treData`) looked up by label,
   and the **hanger it was built from** (`hanger`). The final list is sorted by position.

Consequences:

- A truss that is connected at its top chord **and** its bottom chord has **two hanger lines**
  (`f[8]` = 1 and 2) and so appears **twice**, often at nearly the same position (J4 at 23.25"
  TC and 24" BC).
- Pairing is by the stored `hanger`, **not by list index**. The order of hanger lines in the file
  can differ from the order by position (G2 lists `CG4@50.0001` before `J10@50`).

### 2.4 Reactions and DOL of a connection

Done by `enrichCarriedTrusses()` using the **carried truss's own** `REACTION INFO`.

1. **Bearing to look for.**
   `target = bearingLocation − leftStub` (from `f[16]` and the carried TRE's `Left Stub`). If that
   is negative, `target = span − bearingLocation − rightStub`.
2. **Load cases.** Each load case in `REACTION INFO` is a header line, whose **last value is the
   DOL**, followed by data rows. A header bearing within **4.1"** of the target selects that load
   case.
3. **Rows kept.** Data rows with `col[6] = -1` (governing total) whose X (`col[3]`) is within 4.1"
   of the matched bearing. Each row gives `value` (`col[1]`), `Y` (`col[4]`), and the load case DOL.
4. **TC / BC separation.** An end can bear on both chords: rows at the same X with **two heights
   Y** (example J4: Y = 25.397 and Y = 1.750). If there are two or more distinct Y, the hanger
   keeps only its chord's rows: `f[8] = 1` (TC) keeps the **largest Y**, `f[8] = 2` (BC) keeps the
   **smallest Y** (confirmed by tester). With a single Y nothing is removed. Applies to USA and CAN.
5. **Pick.** Download = the **largest** value. Uplift = the **smallest** value, only if it is
   negative; otherwise Uplift = 0 with no DOL. Each carries the DOL of its load case. The choice
   is by value, not by value ÷ DOL.
6. **Region view.** For **CAN**, load cases whose DOL is not **0.65, 1.00 or 1.15** are ignored
   before step 5 (if none is left, the parsed values are kept). **USA** uses every load case.
   This is recomputed when the region toggle changes, no re-import needed (`applyRegionReactions`).
7. **Fallback** (hanger or matching bearing missing): the summary values `Reaction1/2` and
   `Max Uplift1/2` of the TRE for the left or right end. In the two Canada sample jobs
   (B215062, P-376 Hansen) no connection uses it.

---

## 3. Part 2: Field-by-field reference

Each field shows the **value on screen**, **where it comes from**, and the **API field** that
carries it. Fields marked *editable* can be changed in the Input panel; the change is dropped when
another truss or region is selected.

### 3.1 Connection Type

| On screen | Value | API |
|---|---|---|
| Joist (Flush Top) / **Truss (Flush Bottom)** / Multi-Truss | Truss is always selected. The app only builds Truss connections. | `flushOption = "BOTTOM"` |

### 3.2 Job Settings

| Field | Rule | API |
|---|---|---|
| **Hanger Type** *(editable)* | Default **All Types** (0). Options: Face Mount, Top Flange, Concealed Flange. | `style` |
| **Fastener Type** *(editable)* | Default **All** (0). Options: Nails, Bolts, Screws. | `fastenerType` |
| **Building Code** | Fixed per region: USA **IRC 2018** (20), CAN **Canada** (41). | `buildingCode` |
| **Download Duration** *(editable)* | USA: from the DOL of the Download load case: ≤0.90 → 90, ≤1.00 → 100, ≤1.15 → 115, ≤1.25 → 125, above → 160; no DOL → 125. CAN: always **Standard Term 1.00** (100). | `designInformations.downloadDurationType` |
| **Uplift Duration** *(editable)* | USA: DOL of the Uplift load case ≥ 1.33 → 160, otherwise 100; no uplift → 160. CAN: **DOL × 100**, snapped to the nearest CAN option (100 Standard Term, 115 Short Term; ties to 100); no uplift → **115**. The snapping is **(provisional)**. | `designInformations.upliftLoadDurationType` |
| **ANSI/TPI 1 Evaluation** *(editable)* | USA only: see below. CAN: the field is hidden and `0` is sent. | `ansitpi` |
| **Job ID** | Display only: `<carried label> on <girder label>`. | not sent |

**ANSI/TPI 1 (USA).**
`d` = depth of the girder's bottom chord (the largest cross-section, default 5.5"). Let
`x` = position of the carried truss, left bearing = girder `Left Stub`, right bearing =
`span − Right Stub`. `dist = min(x − left bearing, right bearing − x)`.
`dist < 5d` → **End Connection** (3); otherwise **Interior Connection** (6).

### 3.3 Girder (Carrying Member)

| Field | Rule | API (`carryingMember`) |
|---|---|---|
| **Type** | Truss. | `material` (species code, below) |
| **Lumber Species** | See below. | `material` |
| **Bottom Chord Width** | Width of the **largest cross-section** bottom-chord member (actual inches, default 1.5). Shown as nominal ("2x (1 1/2")"). | `width` |
| **Bottom Chord Height** | Depth of that same member (default 5.5). | `depth` |
| **Number of Plies** | `Ply=` of the girder TRE, default 1. | `ply` |
| **Vertical Width (King Post)** | See below. | `kingWidth` |
| **Total Height** | See below. | `kingHeight` |
| **Member ID** | Girder label. Display only. | not sent |
| (constant) | Top chord is not modelled. | `topChord = 0`, `topChordPly = 0` |

**Lumber Species.**
1. Find the **lowest bottom-chord member**: smallest Y of its coordinates; members at the same
   height prefer the larger cross-section (so zero-height ledger pieces are ignored).
   Rationale **(tester rule)**: the carried truss hangs on the lowest chord. If the bottom chord has
   stacked members, the lower one counts (T01A: 2x8 SP below, 2x4 SPF above, so **SP**).
2. Its `size grade species` string is searched for a species token: `SPF`, `SP`, `HF`, `DF`
   → code **DF 5, HF 6, SP 7, SPF 8**. Unknown → DF.
3. If the member has no coordinates: first bottom chord of the cutting list, then the majority bottom
   chord spec, then (legacy) IFC.
4. **Region substitution:** CAN has no SP, so **SP is sent as DF** **(provisional, tester rule)**.
   CAN also has no HF, so **HF blocks the hanger lookup** with a message; DF and SPF are sent as is.

**Vertical Width (King Post).** The vertical web (king post) under the carried truss, found among
the girder's structural `Web` members:
1. A vertical web has **exactly two distinct X values** (left and right face) and a Y range above 0.5".
2. The carried truss must **fit entirely inside** it: `x − w/2 ≥ left face` and
   `x + w/2 ≤ right face`, where `x` is the truss center and `w` = truss thickness
   (bottom chord width × plies) widened for skew: `w = thickness / cos(skew)` **(tester rule)**.
3. Value = the member's **depth** (face width toward the hanger, e.g. 3.5" for 2x4).
   If no web fits: **N/A** (0).

**Total Height.** The **lower of the two top edges** of that vertical web (its top follows the roof
slope) **(tester rule)**. 0 when there is no king post.

### 3.4 Truss (Carried Member)

| Field | Rule | API (`carriedMembers[0]`) |
|---|---|---|
| **Member Type** | Truss. | `material` |
| **Lumber Species** | Same rule as the girder, applied to the carried truss's TRE. | `material` |
| **Bottom Chord Width** | Width of the carried truss's **largest cross-section** bottom chord (default 1.5). | `width` |
| **Heel Height** | **`f[6]` of the hanger line (block #8)**, taken as is **(tester rule)**. Fallback if missing: the TRE `Left/Right Heel Height` for the bearing side, then 3.5. | `depth` |
| **Number of Plies** | `Ply=` of the carried TRE, default 1. | `ply` |
| **Member ID** | Carried label. Display only. | not sent |
| **Download (ASD / LSD)** | Largest reaction at the connection (2.4), absolute value, rounded to lb. | `loads.load` |
| **Uplift (ASD / LSD)** | Most negative reaction at the connection (2.4), absolute value, rounded to lb. 0 if none. | `loads.uplift` |

The label is **ASD** for USA and **LSD** for CAN. The number is **not converted** between them
**(provisional)**.

### 3.5 Hanger Options

| Field | Rule | API (`carriedMembers[0].angle`) |
|---|---|---|
| **Skew (Degrees)** | From `f[14]`. If the value is ≤ 180: `skew = value − 90`, otherwise `value − 270`. Magnitude rounded; negative = **Left**, positive = **Right**, 0 = None. | `skewAngle`, `skewType` (0 None, 1 Left, 2 Right) |
| **Slope (Degrees)** | **`f[10]` of the hanger line (block #12)** **(tester rule)**. Rounded to an integer (the API field is `int32`): positive = **Down**, negative = **Up**, 0 = None. Fallback without a hanger line: `Bottom Chord Slopes` at the bearing end. | `slopeAngle`, `slopeType` (0 None, 1 Up, 2 Down) |
| **Top Flange Bend** | Shown as 0, no source in the TRE. | not sent |
| **Top Flange Slope** | Shown as 0, no source in the TRE. | not sent |

### 3.6 Constants in the payload

`concealed = 0`, `sort = 0`, `ledger = 0`, `filters = {depth 0, model "", series "", webStiffeners 0, width 0}`.
Hanger Options other than skew and slope are not part of the request.

---

## 4. USA vs CAN at a glance

| Item | USA | CAN |
|---|---|---|
| Building Code | IRC 2018 (20) | Canada (41) |
| ANSI/TPI 1 | computed (3 / 6), shown | hidden, `0` |
| Download Duration | from DOL: 90 / 100 / 115 / 125 / 160, default 125 | always 100 |
| Uplift Duration | DOL ≥ 1.33 → 160, else 100; default 160 | DOL × 100 snapped to 100 / 115; default 115 |
| Load cases used for reactions | all | only DOL 0.65, 1.00, 1.15 |
| Load labels | ASD | LSD (label only) |
| SP lumber | sent as SP (7) | sent as **DF (5)** (provisional) |
| HF lumber | sent as HF (6) | **blocks** the lookup |
| Heel, slope, TC/BC separation, king post, species rule, girder detection | same | same |

---

## 5. Worked example: J4 on J1, bottom-chord hanger at 24" (CAN)

Hanger line in `j1.tre`:
`LG1T=0 1 24 0 J4 1.5 3.5 0 2 1 0 0 0 0 90 0 23.25 0 1 ...`

| Field | Source | Result |
|---|---|---|
| Position | `f[2] = 24` | Offset X = 24" (center of J4) |
| Chord | `f[8] = 2` | BC hanger |
| Heel Height | `f[6] = 3.5` | **3.5"** |
| Slope | `f[10] = 0` | **0° None** |
| Skew | `f[14] = 90` → 90 − 90 | **0° None** |
| Bearing to look for | `f[16] = 23.25`, J4 stubs 0 | 23.25 in `j4.tre` |
| Rows at that bearing (two heights) | Y = 25.397 (TC) and Y = **1.750 (BC)** | keep Y = 1.750 only |
| Load cases at Y = 1.750 | −18.757 (DOL 1.00), −8.453 (1.00), 12.154 (0.65), 13.612 (0.65), −33.573 (1.00) | all DOL valid in CAN |
| **Download (LSD)** | largest = 13.612 | **14 lb** |
| **Uplift (LSD)** | most negative = −33.573 (DOL 1.00) | **34 lb** |
| Download Duration | CAN | Standard Term 1.00 (100) |
| Uplift Duration | DOL 1.00 × 100 | Standard Term 1.00 (100) |
| Vertical Width | J1's king post spans 20.75"–23.25"; J4 at 24" ± 0.75" does not fit | **N/A** |
| Building Code | CAN | Canada (41) |

The top-chord hanger of J4 (`LG2T`, position 23.25", `f[8] = 1`) uses the Y = 25.397 rows, so it
gets **34 lb / 68 lb**, heel 4.206" and a **34° Down** slope.

---

## 6. Known limitations and open items

1. **Bearing side.** The left/right decision reads the header numbers after the bearing
   coordinates too (trailing flags), so it can pick the wrong end for some trusses. Heel and slope
   no longer depend on it unless the hanger line is missing.
2. **Reaction choice.** The Download and Uplift are chosen by raw value, not by value ÷ DOL.
3. **Stacked bottom chords.** Species uses the **lowest** chord, but Bottom Chord Width/Height use
   the **largest** one. They differ when the lower member is the smaller one. Pending a tester
   decision.
4. **Provisional CAN rules.** SP sent as DF, HF blocked, Uplift Duration snapping for DOL values
   outside 1.00 / 1.15, LSD changes the label only. A DOL of 0.65 as the governing uplift would
   send Standard Term 1.00, which gives more capacity than 0.65 allows.
5. **Display quirk.** The "Type" row looks the code up in a label table that has no entry for 8
   (SPF) and labels 6 (HF) as "I-Joist"; the API value itself is correct.
6. **Hanger line meaning.** `f[6]` heel, `f[8]` chord and `f[10]` slope come from tester
   statements and fit the data (e.g. 4.206 = 3.5 / cos 33.69°), but are not documented by MiTek
   or Simpson.
7. **Fastener Type.** The app sends 0 (All). The official CAN request was observed sending 1000 for
   a specific fastener; the code mapping is not verified.
8. **IFC.** The IFC parsing code still exists but is unused in this flow.
9. **Two hangers per end.** A truss with TC and BC hangers appears as two list rows by design.

---

## 7. Source map

| File | Responsibility |
|---|---|
| `src/lib/parser.ts` | TRE parsing, girder detection, carried list, bearing search, hanger lines |
| `src/lib/reactions.ts` | pick Download / Uplift, TC / BC separation, DOL filter, region view |
| `src/lib/sst-mapper.ts` | king post, ANSI/TPI, species, durations, heel, skew, slope, payload |
| `src/lib/sst-types.ts` | API constants and `REGION_CONFIG` (US / CAN rules) |
| `src/lib/region.tsx`, `src/App.tsx` | region toggle and region view of the reactions |
| `src/components/SSTWorkspace.tsx` | Input panel (rows and notes), calling the API |
| `src/types.ts` | `TreData`, `CarriedTruss`, `GirderGroup` |
