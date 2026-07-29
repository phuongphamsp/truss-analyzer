# Truss Analyzer — Phương pháp xác định Reaction & Uplift tại điểm tựa

## 1. Khái niệm cơ bản

Trong một hệ mái sử dụng girder truss, các jack truss (carried truss) **không tựa trực tiếp lên tường hay dầm** mà tựa lên girder tại một đầu. Đầu đó gọi là **bearing end** (đầu tựa).

Mỗi jack truss có **hai đầu**:
- **Đầu LEFT** — tương ứng với `Reaction1` và `Max Uplift1` trong file MiTek TRE
- **Đầu RIGHT** — tương ứng với `Reaction2` và `Max Uplift2` trong file MiTek TRE

Phần mềm cần xác định đầu nào đang tựa lên girder để lấy đúng giá trị reaction.

---

## 2. Nguồn dữ liệu

Phần mềm sử dụng **chỉ file TRE** — không phụ thuộc vào mô hình IFC để xác định bearing end:

| File | Nội dung sử dụng |
|---|---|
| **File TRE của jack truss** | Reaction1/2, Max Uplift1/2, cờ `Girder=YES/NO` |
| **File TRE của girder** | Nhịp girder (`Span`), vị trí hanger (`LGxT` lines) |

> Reaction và Uplift **luôn lấy từ file TRE của jack truss**, không phải của girder.

---

## 3. Quy trình xác định Reaction — 3 bước

### Bước 1: Đọc giá trị Reaction từ file TRE của jack truss

Trong section `[ADDITIONAL TRUSS INFO]` của mỗi file TRE, MiTek xuất ra 4 giá trị:

```
Reaction1    = <giá trị>    ← Phản lực đứng tại đầu LEFT  (lực nén, dương)
Reaction2    = <giá trị>    ← Phản lực đứng tại đầu RIGHT (lực nén, dương)
Max Uplift1  = <giá trị>    ← Lực nhổ tại đầu LEFT        (lực kéo, âm)
Max Uplift2  = <giá trị>    ← Lực nhổ tại đầu RIGHT       (lực kéo, âm)
```

---

### Bước 2: Xác định đầu tựa (bearing end) từ TRE — girderPos rule

Phần mềm đọc **vị trí hanger** (`hangerPos`) từ dòng `LGxT` trong file TRE của girder và so sánh với **tâm nhịp girder**:

```
girderCenter = girderSpan / 2

Nếu carried truss có Girder=YES trong TRE của nó:
    → Đầu LEFT luôn tựa lên girder  →  dùng Reaction1 & Max Uplift1

Nếu carried truss có Girder=NO:
    hangerPos <= girderCenter  →  Đầu LEFT tựa lên girder  →  dùng Reaction1 & Max Uplift1
    hangerPos >  girderCenter  →  Đầu RIGHT tựa lên girder →  dùng Reaction2 & Max Uplift2
```

**Lý do:** Jack truss được thiết kế với đầu LEFT hướng về phía ngắn hơn (gần đầu girder). Khi hanger nằm ở nửa đầu girder (< center), đầu LEFT của jack truss chạm vào girder. Khi hanger nằm ở nửa cuối (> center), jack truss được lật ngược — đầu RIGHT chạm vào girder.

---

### Bước 3: Gán giá trị Reaction & Uplift

| Đầu tựa trên girder | Phản lực đứng (downReaction) | Lực nhổ (upliftReaction) |
|---|---|---|
| Đầu LEFT | Reaction1 | Max Uplift1 |
| Đầu RIGHT | Reaction2 | Max Uplift2 |

---

## 4. Ví dụ thực tế — Girder T04

### 4.1 Thông tin Girder T04

| Thông số | Giá trị |
|---|---|
| Loại | Hip Girder |
| Nhịp | 27'-6½" (330.5") |
| Top Chord | 2x4 No.2 SP |
| Bottom Chord | 2x6 No.1 SP |
| Max CSI Top Chord | 0.86 |
| Max CSI Bottom Chord | 0.82 |
| Phản lực tại gối trái | 2,399 lb |
| Phản lực tại gối phải | 2,399 lb |
| Lực nhổ tại gối trái | -674 lb |
| Lực nhổ tại gối phải | -674 lb |

T04 là girder chạy **vuông góc** với các jack truss J06. Trong mặt bằng, T04 nằm ở vị trí trung tâm, các jack truss J06 tựa vào từ **hai phía** (trái và phải).

---

### 4.2 Các loại Jack Truss tựa lên T04

T04 có **13 điểm tựa** (hanger), gồm 4 loại jack truss khác nhau:

| Loại Jack Truss | Nhịp | Reaction1 (đầu LEFT) | Reaction2 (đầu RIGHT) | Max Uplift1 (đầu LEFT) | Max Uplift2 (đầu RIGHT) |
|---|---|---|---|---|---|
| J06 | 6'-1" (72.94") | 171 lb | 210 lb | -78 lb | -42 lb |
| J06A | 6'-1" (72.94") | 214 lb | 198 lb | -51 lb | -51 lb |
| J06B | 6'-1" (72.96") | 226 lb | 220 lb | -51 lb | -50 lb |
| J06C | 6'-1" (72.94") | 290 lb | 321 lb | -92 lb | -97 lb |

> Các giá trị trên lấy trực tiếp từ file TRE tương ứng (`j06.tre`, `j06a.tre`, `j06b.tre`, `j06c.tre`).

---

### 4.3 Vị trí 13 điểm tựa dọc theo T04

Vị trí đo từ đầu trái của girder T04:

| STT | Loại Jack | Vị trí dọc T04 | Vị trí (ft-in) |
|---|---|---|---|
| 1 | J06C | 30.00" | 2'-6" |
| 2 | J06B | 54.00" | 4'-6" |
| 3 | J06A | 78.00" | 6'-6" |
| 4 | J06 | 102.06" | 8'-6" |
| 5 | J06 | 117.25" | 9'-9¼" |
| 6 | J06 | 141.25" | 11'-9¼" |
| 7 | J06 | 165.25" | 13'-9¼" |
| 8 | J06 | 189.25" | 15'-9¼" |
| 9 | J06 | 213.25" | 17'-9¼" |
| 10 | J06 | 228.44" | 19'-0½" |
| 11 | J06A | 252.50" | 21'-0½" |
| 12 | J06B | 276.50" | 23'-0½" |
| 13 | J06C | 300.50" | 25'-0½" |

---

### 4.4 Áp dụng girderPos rule cho T04

```
girderSpan   = 330.5"
girderCenter = 330.5 / 2 = 165.25"
```

| Hanger | Loại Jack | Vị trí (pos) | Girder=YES? | pos vs center | Đầu tựa |
|---|---|---|---|---|---|
| LG0T | J06C | 30.00" | YES | — | LEFT |
| LG1T | J06B | 54.00" | NO | 54 < 165.25 | LEFT |
| LG2T | J06A | 78.00" | NO | 78 < 165.25 | LEFT |
| LG3T | J06 | 102.06" | NO | 102 < 165.25 | LEFT |
| LG4T | J06 | 117.25" | NO | 117 < 165.25 | LEFT |
| LG5T | J06 | 141.25" | NO | 141 < 165.25 | LEFT |
| LG6T | J06 | 165.25" | NO | 165.25 = 165.25 | LEFT |
| LG7T | J06 | 189.25" | NO | 189 > 165.25 | RIGHT |
| LG8T | J06 | 213.25" | NO | 213 > 165.25 | RIGHT |
| LG9T | J06 | 228.44" | NO | 228 > 165.25 | RIGHT |
| LG10T | J06A | 252.50" | NO | 252 > 165.25 | RIGHT |
| LG11T | J06B | 276.50" | NO | 276 > 165.25 | RIGHT |
| LG12T | J06C | 300.50" | YES | — | LEFT |

---

### 4.5 Kết quả Reaction & Uplift tại từng điểm tựa

Bảng dưới đây phản ánh **kết quả đúng** theo girderPos rule (đã xác nhận với tester engineering):

| STT | Hanger | Loại Jack | Vị trí trên T04 | Đầu tựa | Phản lực đứng | Lực nhổ | Tester |
|---|---|---|---|---|---|---|---|
| 1 | LG0T | J06C | 2'-6" | LEFT | **290 lb** | **-92 lb** | ✓ confirmed |
| 2 | LG1T | J06B | 4'-6" | LEFT | **226 lb** | **-51 lb** | ✓ confirmed |
| 3 | LG2T | J06A | 6'-6" | LEFT | **214 lb** | **-51 lb** | ✓ confirmed |
| 4 | LG3T | J06 | 8'-6" | LEFT | **171 lb** | **-78 lb** | ✓ confirmed |
| 5 | LG4T | J06 | 9'-9¼" | LEFT | **171 lb** | **-78 lb** | ✓ confirmed |
| 6 | LG5T | J06 | 11'-9¼" | LEFT | **171 lb** | **-78 lb** | ✓ confirmed |
| 7 | LG6T | J06 | 13'-9¼" | LEFT | **171 lb** | **-78 lb** | ✓ confirmed |
| 8 | LG7T | J06 | 15'-9¼" | RIGHT | **210 lb** | **-42 lb** | ✓ confirmed |
| 9 | LG8T | J06 | 17'-9¼" | RIGHT | **210 lb** | **-42 lb** | ✓ confirmed |
| 10 | LG9T | J06 | 19'-0½" | RIGHT | **210 lb** | **-42 lb** | ✓ confirmed |
| 11 | LG10T | J06A | 21'-0½" | RIGHT | **198 lb** | **-51 lb** | ✓ confirmed |
| 12 | LG11T | J06B | 23'-0½" | RIGHT | **220 lb** | **-50 lb** | ✓ confirmed |
| 13 | LG12T | J06C | 25'-0½" | LEFT | **290 lb** | **-92 lb** | ✓ confirmed |

> Tất cả 13 hanger đã được xác nhận đúng. Tester chỉ flag các giá trị sai — không flag = đúng.

**Tổng phản lực đứng tác dụng lên T04 từ các jack truss:**

| Loại | Số lượng | Reaction mỗi điểm | Tổng |
|---|---|---|---|
| J06C LEFT (LG0T, LG12T) | 2 | 290 lb | 580 lb |
| J06B LEFT (LG1T) | 1 | 226 lb | 226 lb |
| J06A LEFT (LG2T) | 1 | 214 lb | 214 lb |
| J06 LEFT (LG3T–LG6T) | 4 | 171 lb | 684 lb |
| J06 RIGHT (LG7T–LG9T) | 3 | 210 lb | 630 lb |
| J06A RIGHT (LG10T) | 1 | 198 lb | 198 lb |
| J06B RIGHT (LG11T) | 1 | 220 lb | 220 lb |
| **Tổng cộng** | **13** | — | **2,752 lb** |

---

## 5. Sơ đồ mặt bằng minh họa

```
                        GIRDER T04  (27'-6½" = 330.5")
                    ◄──────────────────────────────────►
    ════════════════╪══════════════╦═══════════════════╪════════════════
                   │              ║ center=13'-9¼"    │
    ←──── 2'-6" ───┤ J06C  290/-92  [LEFT  Girder=YES]
    ←──── 4'-6" ───┤ J06B  226/-51  [LEFT  pos<center]
    ←──── 6'-6" ───┤ J06A  214/-51  [LEFT  pos<center]
    ←──── 8'-6" ───┤ J06   171/-78  [LEFT  pos<center]
    ←── 9'-9¼" ────┤ J06   171/-78  [LEFT  pos<center]
    ←── 11'-9¼" ───┤ J06   171/-78  [LEFT  pos<center]
    ←── 13'-9¼" ───┤ J06   171/-78  [LEFT  pos=center]
                   ║ ← midpoint
    ←── 15'-9¼" ───┤ J06   210/-42  [RIGHT pos>center]
    ←── 17'-9¼" ───┤ J06   210/-42  [RIGHT pos>center]
    ←── 19'-0½" ───┤ J06   210/-42  [RIGHT pos>center]
    ←── 21'-0½" ───┤ J06A  198/-51  [RIGHT pos>center]
    ←── 23'-0½" ───┤ J06B  220/-50  [RIGHT pos>center]
    ←── 25'-0½" ───┤ J06C  290/-92  [LEFT  Girder=YES]
    ════════════════╪══════════════╩═══════════════════╪════════════════
                   │                                   │
               Gối trái                           Gối phải
               2,399 lb                           2,399 lb
               Uplift: -674 lb                    Uplift: -674 lb

    Ghi chú: Mỗi mũi tên ← là một jack truss tựa vào T04
             Giá trị: (Phản lực đứng lb / Lực nhổ lb)
             [LEFT/RIGHT]: đầu nào của jack truss chạm vào girder
```

---

## 6. Lưu ý kỹ thuật

1. **Reaction lấy từ file TRE của jack truss**, không phải của girder. Girder chỉ cung cấp thông tin về vị trí hanger và nhịp.

2. **Tất cả jack truss cùng loại** (ví dụ: 7 truss J06) có cùng giá trị Reaction1/Reaction2 vì chúng có cùng nhịp và tải trọng. Sự khác biệt reaction giữa các điểm tựa chỉ đến từ việc đầu nào đang tựa lên girder (LEFT hay RIGHT).

3. **Vị trí hanger** (2'-6", 4'-6"...) được dùng để xác định bearing side (LEFT/RIGHT) theo girderPos rule, vẽ sơ đồ, và tìm member bottom chord tương ứng.

4. **J06C là Jack-Closed Girder** (`Girder=YES` trong TRE). Phần mềm luôn dùng LEFT (Reaction1) cho loại này, bất kể vị trí hanger. Cơ chế kiểm tra riêng tránh tính toán vòng lặp (girder tựa lên girder).

5. **Không phụ thuộc IFC:** Logic bearing side hoàn toàn từ TRE. File IFC chỉ dùng cho hiển thị 3D, không ảnh hưởng đến giá trị reaction/uplift.

6. **Implementation:** Hàm `determinePhysicalCarriedEnd(hangerPosInches, girderSpanInches, carriedIsGirder)` trong `src/lib/parser.ts` thực hiện rule này. Được gọi từ `enrichCarriedTrusses()`.
