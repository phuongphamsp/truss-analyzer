# TRE-based Bearing Detection

## Mục đích

Xác định `downReaction` và `upliftReaction` tại đúng bearing end của mỗi carried truss trên girder, dựa hoàn toàn vào dữ liệu TRE — không phụ thuộc IFC geometry.

## Vấn đề của phương pháp cũ (IFC bbox)

Phương pháp cũ dùng bounding box IFC để xác định carried truss đang bearing ở đầu nào (left/right) của girder, sau đó lấy `Reaction1` hoặc `Reaction2` tương ứng. Vấn đề:

- Nếu không tìm được IFC instance (MOCK) → fallback `left` → sai
- Với T04: LG0T, LG10T, LG11T, LG12T đều là MOCK → kết quả sai
- Phụ thuộc vào IFC file — nếu không có IFC thì toàn bộ sai

## Phương pháp mới (TRE-based)

### Nguồn dữ liệu

1. **Girder TRE** (`t04.tre`): mỗi hanger `LG*T` có ghi sẵn `bearingLocation` của carried truss
2. **Carried truss TRE** (`j06c.tre`, `j06.tre`, ...): section `REACTION INFO` chứa reaction tại từng bearing end cho tất cả load cases

### Bước 1 — Parse `bearingLocation` từ Girder TRE

Mỗi dòng `LG*T` trong `[Hanger Loading Info.]`:

```
LG0T=0 1 30.0001 0 J06C 1.5 17.1006 9 2 1 0 0 0 0 90 0 71.1875 -1.72552 ...
                                                              ^^^^^^^
                                                    field[16] = bearingLocation = 71.1875"
```

`bearingLocation` là tọa độ (inches) của bearing end của carried truss tại hanger đó.

### Bước 2 — Cấu trúc REACTION INFO trong Carried Truss TRE

```
REACTION INFO
54                                          ← số load cases
2 -1 -1 -1 -1 0.000000 71.187500 3 3 ...   ← header block
              ^^^^^^^^  ^^^^^^^^^
              bearingA  bearingB            ← 2 đầu bearing của carried truss
0    290.145 5     71.188  1.750 2 -1  ...  ← dòng TỔNG tại bearingB (71.188 ≈ 71.1875)
0    146.601 5     71.188  1.750 2  0  ...  ← dòng thành phần (dead load)
0    143.544 5     71.188  1.750 2  4  ...  ← dòng thành phần (live load)
0    320.976 2      0.000  4.060 2 -1  ...  ← dòng TỔNG tại bearingA (0.000) → bỏ qua
...
2 -1 -1 -1 -1 0.000000 71.187500 ...       ← header block load case tiếp theo
0    313.574 5     71.188  ...  2 -1  ...   ← dòng tổng block 2
...
```

Mỗi block = 1 load case. Trong mỗi block, data lines chia 2 nhóm theo bearing location.

**Điều kiện lọc dòng tổng:**

| Column | Index | Giá trị | Ý nghĩa |
|--------|-------|---------|---------|
| col[3] | 3 | ≈ `bearingLocation` (±0.5") | đúng bearing end |
| col[6] | 6 | `-1` | dòng tổng (governing) |

### Bước 3 — Match bearing location

So sánh `bearingLocation` từ girder TRE với `bearingA` và `bearingB` trong header block:

```
targetBearing = 71.1875  (từ LG0T trong t04.tre)

header: 2 -1 -1 -1 -1  0.000000  71.187500  ...
                        bearingA  bearingB
                        
|0.000 - 71.1875| = 71.19  → không match
|71.1875 - 71.1875| = 0.0  → MATCH ✓  → đọc nhóm data lines có col[3] ≈ 71.1875
```

Trường hợp `bearingLocation = 0.000` thì match với `bearingA`.

### Bước 4 — Collect values và tính kết quả

```
values = [290.145, 313.574, 271.831, ..., -92.113, ...]  (54 load cases)

downReaction   = max(values) = 377.308 lb
upliftReaction = min(values) = -92.113 lb
```

### Kết quả cho T04

| Hanger | Label | bearingLoc | downReaction | upliftReaction |
|--------|-------|-----------|--------------|----------------|
| LG0T   | J06C  | 71.1875"  | 377.308 lb   | -92.113 lb     |
| LG1T   | J06B  | 71.2134"  | 280.184 lb   | -50.245 lb     |
| LG2T   | J06A  | 71.1875"  | 233.420 lb   | -50.692 lb     |
| LG3T–LG9T | J06 | 71.1875" | 263.176 lb  | -78.182 lb     |
| LG10T  | J06A  | 71.1875"  | 233.420 lb   | -50.692 lb     |
| LG11T  | J06B  | 71.2134"  | 280.184 lb   | -50.245 lb     |
| LG12T  | J06C  | 71.1875"  | 377.308 lb   | -92.113 lb     |

## Implementation

### Files thay đổi

| File | Thay đổi |
|------|---------|
| `src/types.ts` | Thêm `bearingLocation` vào hanger type; thêm `rawText` vào `TreData` |
| `src/lib/parser.ts` | Thêm `parseReactionAtBearing()`; cập nhật `parseHangers()`; cập nhật `enrichCarriedTrusses()` |

### Functions

**`parseHangers(text)`** — `parser.ts:546`
- Parse thêm `bearingLocation` từ field[16] của mỗi `LG*T` line

**`parseReactionAtBearing(carriedTreTxt, targetBearing)`** — `parser.ts:~800`
- Core function của phương pháp mới
- Input: raw text của carried truss TRE + bearing location cần tìm
- Output: `{ downReaction, upliftReaction }` hoặc `null` nếu không parse được

**`enrichCarriedTrusses(carriedTrusses, girder)`** — `parser.ts:~934`
- Primary: gọi `parseReactionAtBearing()` nếu có `bearingLocation` và `rawText`
- Fallback: IFC bbox method nếu TRE-based không có dữ liệu

### Fallback

Nếu `bearingLocation = 0` hoặc `rawText` không có `REACTION INFO` → tự động fallback về phương pháp IFC bbox cũ.

## So sánh phương pháp

| | IFC bbox (cũ) | TRE-based (mới) |
|--|--------------|-----------------|
| Nguồn dữ liệu | IFC bounding box | TRE REACTION INFO |
| Cần IFC? | Có | Không |
| MOCK instances | fallback `left` → có thể sai | Không ảnh hưởng |
| Giá trị | Reaction1 hoặc Reaction2 | max/min của tất cả load cases |
| Độ chính xác | Phụ thuộc IFC geometry | Trực tiếp từ structural analysis |
