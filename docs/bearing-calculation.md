# Bearing Calculation — Implementation Spec

> **Audience:** AI agent or developer implementing this from scratch in any language.  
> This document is self-contained. No prior knowledge of the codebase is required.

---

## Problem Statement

A **girder truss** supports multiple **carried trusses** via hangers. Each carried truss rests on the girder at one specific end (its bearing end). Given the raw text of two TRE files, compute:

- `downReaction` — maximum downward load (lb, positive) at the bearing end across all load cases
- `upliftReaction` — minimum uplift load (lb, negative) at the bearing end across all load cases

---

## Inputs

| Input | Type | Description |
|-------|------|-------------|
| `girderTreText` | `string` | Raw text content of the girder's `.tre` file |
| `carriedTreText` | `string` | Raw text content of the carried truss's `.tre` file |
| `hangerIndex` | `number` | Which hanger on the girder this carried truss connects to (0-based) |

---

## Output

```typescript
interface BearingResult {
  downReaction: number;    // max positive reaction across all load cases (lb)
  upliftReaction: number;  // min negative reaction across all load cases (lb)
}
```

Returns `null` if the data cannot be parsed (triggers fallback — see end of document).

---

## Algorithm

### Step 1 — Extract `bearingLocation` from Girder TRE

**Goal:** Find the coordinate (inches) of the carried truss's bearing end.

**Where to look:** Section `[Hanger Loading Info.]` in the girder TRE file.

**Line format:**

```
LG0T=0 1 30.0001 0 J06C 1.5 17.1006 9 2 1 0 0 0 0 90 0 71.1875 -1.72552 ...
```

**Parse rules:**

1. Find the line starting with `[Hanger Loading Info.]` — set a flag `inHangerSection = true`
2. For each subsequent line matching pattern `LG\d+T=...`:
   - Split on `=`, take the right side
   - Split by whitespace → array `parts[]`
   - `bearingLocation = parseFloat(parts[16])` (0-based index)
3. Stop when a new `[...]` section header is encountered

**Field map for `parts[]` (after splitting the value side of `LG*T=`):**

```
Index:  [0]  [1]    [2]    [3]  [4]    [5]    [6]     [7] [8] [9] ... [16]
Value:   0    1   30.0001   0   J06C   1.5   17.1006   9   2   1  ...  71.1875
                  ^xInches       ^label ^width ^heelHt              ^bearingLocation
```

**Key field:** `parts[16]` = `bearingLocation` in inches from the left end of the carried truss.

**Edge case:** If `parts.length <= 16` or result is `NaN`, set `bearingLocation = 0` (will trigger fallback).

**Example:**
```
LG0T=0 1 30.0001 0 J06C 1.5 17.1006 9 2 1 0 0 0 0 90 0 71.1875 ...
                                                              ↑
                                                    bearingLocation = 71.1875"
```

---

### Step 2 — Locate `REACTION INFO` Section in Carried Truss TRE

**Goal:** Find the block of reaction data in the carried truss TRE.

**Parse rules:**

1. Split the carried truss TRE text by newlines
2. Scan line by line until `line.trim() === 'REACTION INFO'`
3. Skip that line
4. Skip blank lines
5. Skip the next non-blank line (it is the load case count, e.g. `54`)
6. Now positioned at the first **header block** line

**If `REACTION INFO` is not found:** return `null` (triggers fallback).

---

### Step 3 — Parse Header Blocks and Match Bearing

**Goal:** Identify which bearing coordinate (`bearingA` or `bearingB`) matches `bearingLocation`.

**Constant:** `TOLERANCE = 0.5` (inches)

**Header block line format:**

```
2 -1 -1 -1 -1  0.000000  71.187500  3 3 ...
               ^^^^^^^^^  ^^^^^^^^^
               bearingA   bearingB
```

**Recognition rule:** A line is a header block if it starts with `2 -1 -1 -1 -1`.

**Parse:**
```
parts = line.split(/\s+/)
bearingA = parseFloat(parts[5])
bearingB = parseFloat(parts[6])
```

**Match logic:**
```
matchA = |bearingA - targetBearing| <= 0.5
matchB = |bearingB - targetBearing| <= 0.5

if neither matches → skip this block entirely
if matchA → matchedBearing = bearingA
if matchB → matchedBearing = bearingB
```

---

### Step 4 — Collect Governing Reactions from Data Lines

**Goal:** For each matched header block, collect the governing (total) reaction value at the matched bearing.

**Data line format:**

```
0    290.145  5   71.188  1.750  2  -1  ...
^    ^^^^^^^      ^^^^^^         ^  ^^
col0 col1         col3           col5 col6
```

**Recognition rule:** A line is a data line if it starts with `0` (after trim).

**Filter conditions — collect `col[1]` only when BOTH are true:**

| Condition | Check |
|-----------|-------|
| Governing load case | `parseFloat(col[6]) === -1` |
| Correct bearing end | `|parseFloat(col[3]) - matchedBearing| <= 0.5` |

**Block boundary:** Stop reading data lines when:
- A new header line starting with `2 -1 -1 -1 -1` is encountered (next load case)
- A line `REACTION INFO` is encountered (next section)
- A line starting with `[` is encountered (next TRE section)

**Repeat** for every header block in the file (one per load case).

---

### Step 5 — Compute Final Result

```
values = all collected col[1] values across all load cases

downReaction   = max(values)   // largest positive value
upliftReaction = min(values)   // smallest (most negative) value
```

If `values` is empty → return `null`.

---

## Complete Pseudocode

```
function computeBearingReactions(girderTreText, carriedTreText, hangerIndex):

  // Step 1: get bearingLocation from girder TRE
  hangers = parseHangers(girderTreText)
  hanger = hangers[hangerIndex]
  if hanger is null or hanger.bearingLocation == 0:
    return null  // trigger fallback

  targetBearing = hanger.bearingLocation

  // Step 2: find REACTION INFO
  lines = carriedTreText.split('\n')
  i = 0
  while i < lines.length and lines[i].trim() != 'REACTION INFO':
    i++
  if i >= lines.length:
    return null  // no REACTION INFO section

  i++  // skip 'REACTION INFO'
  while lines[i].trim() == '': i++  // skip blanks
  i++  // skip load case count line

  // Steps 3-4: parse blocks
  values = []
  while i < lines.length:
    line = lines[i].trim()

    if not line.startsWith('2 -1 -1 -1 -1'):
      i++
      continue

    // Parse header
    parts = line.split(/\s+/)
    if parts.length < 7: i++; continue

    bearingA = parseFloat(parts[5])
    bearingB = parseFloat(parts[6])

    matchA = |bearingA - targetBearing| <= 0.5
    matchB = |bearingB - targetBearing| <= 0.5
    if not matchA and not matchB: i++; continue

    matchedBearing = matchA ? bearingA : bearingB

    // Read data lines of this block
    i++
    while i < lines.length:
      dl = lines[i].trim()

      if dl.startsWith('2 -1 -1 -1 -1'): break  // next header
      if dl == 'REACTION INFO': break
      if dl.startsWith('[') and dl != '': break

      if not dl.startsWith('0'): i++; continue

      dp = dl.split(/\s+/)
      if dp.length < 7: i++; continue

      value      = parseFloat(dp[1])
      bearingLoc = parseFloat(dp[3])
      loadType   = parseFloat(dp[6])

      if loadType == -1 and |bearingLoc - matchedBearing| <= 0.5:
        values.push(value)

      i++

  // Step 5: result
  if values.length == 0:
    return null

  return {
    downReaction:   max(values),
    upliftReaction: min(values)
  }
```

---

## Fallback — When TRE-based Method Fails

Use this when `computeBearingReactions()` returns `null` (i.e., `bearingLocation = 0` or no `REACTION INFO`).

**Inputs required:** IFC bounding boxes of the carried truss and the girder.

```
interface BoundingBox {
  minX, maxX, minY, maxY: number
}
```

**Algorithm:**

```
function determinePhysicalCarriedEnd(carriedBox, girderBox):

  girderCenterX = (girderBox.minX + girderBox.maxX) / 2
  girderCenterY = (girderBox.minY + girderBox.maxY) / 2

  // Determine primary axis of carried truss
  cAlongX = (carriedBox.maxX - carriedBox.minX) > (carriedBox.maxY - carriedBox.minY)

  if cAlongX:
    distLeft  = |carriedBox.minX - girderCenterX|
    distRight = |carriedBox.maxX - girderCenterX|
  else:
    distLeft  = |carriedBox.minY - girderCenterY|
    distRight = |carriedBox.maxY - girderCenterY|

  return distLeft < distRight ? 'left' : 'right'
```

**Then map `bearingSide` to reactions from the TRE `reactions` object:**

```
if bearingSide == 'left':
  downReaction   = treData.reactions.leftDown   // Reaction1
  upliftReaction = treData.reactions.leftUp     // Max Uplift1
else:
  downReaction   = treData.reactions.rightDown  // Reaction2
  upliftReaction = treData.reactions.rightUp    // Max Uplift2
```

**Limitation:** If the carried truss has no IFC instance (MOCK), `bearingSide` defaults to `'left'`, which may be incorrect.

---

## Data Structures

```typescript
// Hanger parsed from girder TRE
interface Hanger {
  xInches: number;          // position on girder from left end (inches)
  xFeet: number;            // xInches / 12
  label: string;            // carried truss label, e.g. "J06C"
  width: number;            // hanger width (inches)
  heelHeight: number;       // heel height (inches)
  bearingLocation: number;  // bearing coord on carried truss (inches); 0 = unknown
}

// Carried truss after enrichment
interface CarriedTruss {
  downReaction?: number;    // max downward reaction at bearing (lb)
  upliftReaction?: number;  // min uplift reaction at bearing (lb, negative)
  bearingSide?: 'left' | 'right';  // only set when fallback method is used
}

// TRE reactions (used by fallback method only)
interface TreReactions {
  leftDown: number;   // Reaction1 downward
  rightDown: number;  // Reaction2 downward
  leftUp: number;     // Max Uplift1 (negative)
  rightUp: number;    // Max Uplift2 (negative)
}
```

---

## Decision Tree

```
hanger.bearingLocation > 0
AND carriedTreText contains 'REACTION INFO'
AND parseReactionAtBearing() finds matching values
         │
         ├─ YES → use TRE-based result
         │         downReaction   = max(values over all load cases)
         │         upliftReaction = min(values over all load cases)
         │         bearingSide    = undefined (not needed)
         │
         └─ NO  → use IFC bbox fallback
                   bearingSide    = determinePhysicalCarriedEnd()
                   downReaction   = treReactions.leftDown or rightDown
                   upliftReaction = treReactions.leftUp   or rightUp
```

---

## Worked Example

**Girder TRE line:**
```
LG0T=0 1 30.0001 0 J06C 1.5 17.1006 9 2 1 0 0 0 0 90 0 71.1875 -1.72552
```
→ `targetBearing = 71.1875`

**Carried truss TRE (excerpt):**
```
REACTION INFO
54
2 -1 -1 -1 -1  0.000000  71.187500  3 3 ...    ← bearingA=0.0, bearingB=71.1875
0    290.145  5   71.188  1.750  2  -1  ...     ← total at bearingB ✓ → collect 290.145
0    146.601  5   71.188  1.750  2   0  ...     ← dead load → skip (col[6]≠-1)
0    320.976  2    0.000  4.060  2  -1  ...     ← total at bearingA → skip (wrong bearing)
2 -1 -1 -1 -1  0.000000  71.187500  ...        ← load case 2
0    313.574  5   71.188  ...  2  -1  ...       ← collect 313.574
...  (54 load cases total)
0    -92.113  5   71.188  ...  2  -1  ...       ← collect -92.113 (uplift case)
```

**Result:**
```
values = [290.145, 313.574, 271.831, ..., -92.113]

downReaction   = max(values) = 377.308 lb
upliftReaction = min(values) = -92.113 lb
```

---

## Edge Cases and Gotchas

| Situation | Behavior |
|-----------|----------|
| `parts[16]` missing in `LG*T` line | `bearingLocation = 0` → fallback |
| `REACTION INFO` absent in carried TRE | return `null` → fallback |
| No data lines match after tolerance check | return `null` → fallback |
| `bearingLocation = 0.000` (left end) | matches `bearingA = 0.000` — valid, not a missing value |
| Floating point mismatch (71.1875 vs 71.188) | Tolerance ±0.5" handles this |
| Carried truss has no IFC bounding box | `determinePhysicalCarriedEnd()` returns `'left'` as default |
| Multiple hangers with same carried truss label | Each hanger has its own `bearingLocation`; process independently |
