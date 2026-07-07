# [LEGACY] Xác định Bearing End bằng IFC Bounding Box

> **Trạng thái:** Đang dùng (phương pháp hiện tại trong production)
> **Implementation:** `src/lib/parser.ts` — hàm `determinePhysicalCarriedEnd()`
> **Xem thêm:** `docs/tre-based-bearing-detection.md` (nghiên cứu thay thế, chưa implement)

---

## 1. Tổng quan

Cách tiếp cận cũ xác định đầu tựa (bearing end) của carried truss bằng cách so sánh **tọa độ IFC 3D** của carried truss với **tâm của girder** trong không gian mô hình BIM.

Nguồn dữ liệu bắt buộc:
- **File IFC** — cung cấp `boundingBox` (minX, maxX, minY, maxY) cho từng truss instance
- **File TRE** — chỉ dùng để lấy giá trị Reaction/Uplift sau khi bearing side đã xác định

---

## 2. Nguyên lý hoạt động

### 2.1 Bounding Box của mỗi truss instance

Từ IFC, mỗi truss instance có một bounding box 2D trong mặt bằng:

```
BoundingBox {
  minX, maxX,   // tọa độ theo trục X (inches, hệ IFC)
  minY, maxY    // tọa độ theo trục Y (inches, hệ IFC)
}
```

Đầu LEFT và đầu RIGHT của truss tương ứng với hai đầu theo chiều dài của bounding box.

### 2.2 Xác định hướng của carried truss

```typescript
const cAlongX = (cBox.maxX - cBox.minX) > (cBox.maxY - cBox.minY);
```

- `cAlongX = true`  → truss chạy theo trục X → đầu LEFT = `minX`, đầu RIGHT = `maxX`
- `cAlongX = false` → truss chạy theo trục Y → đầu LEFT = `minY`, đầu RIGHT = `maxY`

### 2.3 Tâm girder trong hệ tọa độ IFC

```typescript
const girderCenterX = (gBox.minX + gBox.maxX) / 2;
const girderCenterY = (gBox.minY + gBox.maxY) / 2;
```

### 2.4 So sánh khoảng cách

Đầu nào của carried truss **gần tâm girder hơn** → đầu đó đang tựa lên girder:

```typescript
if (cAlongX) {
  const distLeft  = Math.abs(cBox.minX - girderCenterX);
  const distRight = Math.abs(cBox.maxX - girderCenterX);
  return distLeft < distRight ? 'left' : 'right';
} else {
  const distLeft  = Math.abs(cBox.minY - girderCenterY);
  const distRight = Math.abs(cBox.maxY - girderCenterY);
  return distLeft < distRight ? 'left' : 'right';
}
```

---

## 3. Code gốc (đã xóa)

```typescript
function determinePhysicalCarriedEnd(
  c: TrussInstance,
  girder: TrussInstance
): 'left' | 'right' {
  const cBox = c.boundingBox;
  const gBox = girder.boundingBox;

  if (!cBox || !gBox) return 'left';   // fallback khi không có IFC data

  const girderCenterX = (gBox.minX + gBox.maxX) / 2;
  const girderCenterY = (gBox.minY + gBox.maxY) / 2;

  const cAlongX = (cBox.maxX - cBox.minX) > (cBox.maxY - cBox.minY);

  if (cAlongX) {
    const leftEndX  = cBox.minX;
    const rightEndX = cBox.maxX;
    const distLeft  = Math.abs(leftEndX  - girderCenterX);
    const distRight = Math.abs(rightEndX - girderCenterX);
    return distLeft < distRight ? 'left' : 'right';
  } else {
    const leftEndY  = cBox.minY;
    const rightEndY = cBox.maxY;
    const distLeft  = Math.abs(leftEndY  - girderCenterY);
    const distRight = Math.abs(rightEndY - girderCenterY);
    return distLeft < distRight ? 'left' : 'right';
  }
}
```

Call site trong `enrichCarriedTrusses()`:

```typescript
const bearingSide = determinePhysicalCarriedEnd(c.instance, girder);
```

---

## 4. Ví dụ thực tế — Girder T04 (Test3)

Với T04 (`t04.tre`, span = 330.5"), tâm girder trong hệ IFC ≈ **501.54"** theo trục X.

Các jack truss tựa vào T04 từ **hai phía vật lý**:

**Nhóm tựa từ phía ĐÔNG của T04** (đầu LEFT của jack truss chạm girder):
```
Đầu LEFT  (minX) ≈ 503"  →  |503 - 501.54| = 1.5"   ← RẤT GẦN
Đầu RIGHT (maxX) ≈ 576"  →  |576 - 501.54| = 74.5"
→ distLeft < distRight  →  bearing = LEFT  →  Reaction1 & Max Uplift1
```

**Nhóm tựa từ phía TÂY của T04** (đầu RIGHT của jack truss chạm girder):
```
Đầu LEFT  (minX) ≈ 427"  →  |427 - 501.54| = 74.5"
Đầu RIGHT (maxX) ≈ 503"  →  |503 - 501.54| = 1.5"   ← RẤT GẦN
→ distRight < distLeft  →  bearing = RIGHT  →  Reaction2 & Max Uplift2
```

---

## 5. Vấn đề dẫn đến thay thế

### 5.1 MOCK instances

Khi IFC không có instance tương ứng cho một carried truss (label không khớp), `computeCarriedTrussGeometry()` tạo ra một **MOCK instance** không có `boundingBox`:

```typescript
inst = {
  id: `MOCK_${h.label}_${Math.random()}`,
  label: h.label,
  isGirder: false
  // boundingBox: undefined  ← không có!
};
```

Hàm cũ fallback về `'left'` khi `!cBox || !gBox`, dẫn đến **tất cả MOCK instances đều bị gán LEFT** bất kể vị trí thực tế.

### 5.2 Kết quả sai trên Test3/T04

| Hanger | Loại | Vị trí | Kết quả cũ | Đúng phải là | Lỗi |
|---|---|---|---|---|---|
| LG10T | J06A | 21'-0½" | LEFT → 214 lb | RIGHT → 198 lb | MOCK fallback |
| LG11T | J06B | 23'-0½" | LEFT → 226 lb | RIGHT → 220 lb | MOCK fallback |

Tester engineering xác nhận 2 giá trị này sai.

### 5.3 Phụ thuộc IFC

Logic hoàn toàn phụ thuộc vào chất lượng và sự hiện diện của IFC file. Nếu chạy với TRE-only (không có IFC), toàn bộ bearing detection sẽ fallback về LEFT cho mọi truss.

---

## 6. Tham khảo

- Cách mới: `docs/tre-based-bearing-detection.md`
- Implementation mới: `src/lib/parser.ts` — hàm `determinePhysicalCarriedEnd()`
- Test data: `Test3/t04.tre`, `Test3/j06.tre`, `Test3/j06a.tre`, `Test3/j06b.tre`, `Test3/j06c.tre`
