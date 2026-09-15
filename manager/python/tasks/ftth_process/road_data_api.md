# Road Data API Spec

Spesifikasi API untuk mengambil data ruas jalan (road segment) dari database
**eksternal**. API ini menggantikan query PostGIS internal ke tabel `sp_data_road`
(data HERE) yang saat ini dipakai oleh fungsi `_get_gdf_road_local` di
[lib/ftth_process.py](../../lib/ftth_process.py).

Konsumen API: pipeline geoprocessing FTTH
([tasks/ftth_process/generate_network.py](generate_network.py) →
`get_gdf_road(..., road_mode="local")`).

---

## 1. Ringkasan kebutuhan

Diberikan **area** (polygon), API mengembalikan seluruh ruas jalan yang
**intersect** dengan area tersebut, dengan **jalan tol di-exclude**.

> **Tanpa buffer.** API tidak melakukan buffering. Buffer area dilakukan di sisi
> klien; klien mengirim polygon area apa adanya.

> **Sinkron (synchronous).** Hasil dikembalikan langsung di response yang sama —
> tidak ada pola async (job-id + polling). Volume request rendah (1× per job
> geoprocessing), jadi request/response sinkron sudah cukup.

Perilaku inti yang harus direplikasi (bagian query saat ini):

```sql
SELECT r.ogc_fid, r.class_func, ST_AsBinary(r.geom) AS geom
FROM sp_data_road r
WHERE r.geom && :area
  AND ST_Intersects(r.geom, :area)
  AND r.class_func != '1';   -- exclude jalan tol
```

Catatan penting semantik:

- **CRS**: input & output geometry di **EPSG:4326**.
- **Filter tol**: `class_func = '1'` = jalan tol dan **harus di-exclude** dari hasil.
- **Tipe `class_func`**: bertipe **text/string** (`'1'`..`'5'`), bukan integer.
- **Geometry**: satu ruas bisa tersimpan sebagai `MultiLineString`. Klien akan
  melakukan `linemerge` sendiri, jadi API boleh mengembalikan `LineString`
  maupun `MultiLineString` apa adanya.

---

## 2. Endpoint

```
POST /api/v1/roads/query
```

| Item | Nilai |
|------|-------|
| Method | `POST` |
| Content-Type | `application/json` |
| Auth | `Authorization: Bearer <API_KEY>` (silakan tim tentukan) |

> Dipakai `POST` (bukan `GET`) karena payload berisi geometry polygon yang bisa
> besar dan tidak praktis di query string.

---

## 3. Request

### Body

```jsonc
{
  "area": {
    "type": "Polygon",
    "coordinates": [[[lon, lat], [lon, lat], ...]]
  },
  "exclude_class_func": ["1"],
  "srid": 4326
}
```

| Field | Tipe | Wajib | Default | Keterangan |
|-------|------|-------|---------|------------|
| `area` | GeoJSON Geometry (`Polygon` / `MultiPolygon`) | ya | — | Area query, EPSG:4326. Dikirim apa adanya (buffer sudah dilakukan klien bila perlu). |
| `exclude_class_func` | array of string | tidak | `["1"]` | Nilai `class_func` yang di-exclude. Default meng-exclude tol. |
| `srid` | integer | tidak | `4326` | SRID dari `area`. Output selalu 4326. |

---

## 4. Response

### 200 OK

`FeatureCollection` GeoJSON (EPSG:4326):

```jsonc
{
  "type": "FeatureCollection",
  "total": 128,
  "crs": { "type": "name", "properties": { "name": "EPSG:4326" } },
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[lon, lat], [lon, lat], ...]
      },
      "properties": {
        "ogc_fid": 123456,
        "class_func": "3"
      }
    }
  ]
}
```

| Field (properties) | Tipe | Keterangan |
|--------------------|------|------------|
| `ogc_fid` | integer | ID unik ruas jalan (primary key sumber). |
| `class_func` | string | Kelas fungsi jalan HERE (`'2'`..`'5'`; `'1'`/tol sudah di-exclude). |
| `geometry` | LineString / MultiLineString | Geometry ruas, EPSG:4326. |

`total` = jumlah feature yang dikembalikan.

### Kontrak minimum

Field yang **wajib** ada agar pipeline berjalan: `ogc_fid`, `class_func`,
`geometry`. Field lain boleh ditambahkan dan akan diabaikan klien.

---

## 5. Error

| HTTP | Kondisi | Body |
|------|---------|------|
| `400` | `area` invalid / bukan polygon / SRID tidak dikenal | `{ "error": "invalid area geometry" }` |
| `401` | API key tidak valid | `{ "error": "unauthorized" }` |
| `429` | Rate limit terlampaui (lihat §6) | `{ "error": "rate limit exceeded", "retry_after": 12 }` |
| `200` + `total: 0` | Tidak ada jalan di area (features kosong) | `{ "type": "FeatureCollection", "total": 0, "features": [] }` |
| `500` | Error internal / DB | `{ "error": "internal error" }` |

> **Catatan "No road found":** pipeline saat ini melempar error `"No road found"`
> ketika hasil kosong. Penanganan kondisi kosong dilakukan di sisi klien, jadi
> API cukup mengembalikan `200` dengan `features: []` (bukan error).

---

## 6. Rate limit

API dilindungi rate limit **per API key**. Batas longgar — hanya untuk menjaga
dari retry-loop atau bug, bukan membatasi pemakaian normal (1 request per job).

| Item | Nilai (usulan) |
|------|----------------|
| Limit | **60 request / menit** per API key |
| Algoritma | sliding window / token bucket (bebas, sesuai stack tim) |
| Response saat terlampaui | `429 Too Many Requests` |

Header yang dikembalikan di setiap response (disarankan, mengikuti konvensi umum):

| Header | Keterangan |
|--------|------------|
| `X-RateLimit-Limit` | Kuota per window (mis. `60`). |
| `X-RateLimit-Remaining` | Sisa kuota di window saat ini. |
| `Retry-After` | Detik menunggu sebelum retry (dikirim saat `429`). |

Body `429`:

```json
{ "error": "rate limit exceeded", "retry_after": 12 }
```

Klien akan menghormati `Retry-After` sebelum mencoba ulang.

---

## 7. Referensi `class_func` → pole_type

Hanya untuk konteks (pemetaan dilakukan di sisi klien di
`generate_gdf_odp_candidate`). Menegaskan bahwa `class_func` bertipe string
dan nilai `1` adalah tol.

| `class_func` | Arti | pole_type (klien) |
|:---:|------|:---:|
| `1` | Jalan tol | **di-exclude** |
| `2` | Arteri utama | T9 |
| `3` | Arteri | T7 |
| `4` | Kolektor | T7 |
| `5` | Lokal | T6 |

---

## 8. Contoh cURL

```bash
curl -X POST https://<host>/api/v1/roads/query \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "area": {
      "type": "Polygon",
      "coordinates": [[[106.80,-6.20],[106.82,-6.20],[106.82,-6.22],[106.80,-6.22],[106.80,-6.20]]]
    },
    "exclude_class_func": ["1"]
  }'
```

---

## 9. Non-fungsional (usulan)

- **Sinkron**: satu request → satu response berisi seluruh hasil. Tanpa async
  (job-id/polling) dan **tanpa pagination** — seluruh ruas dikembalikan sekaligus.
- **Performa**: gunakan spatial index (GiST) pada kolom geom sumber; query harus
  memakai bounding-box (`&&`) + `ST_Intersects` seperti query asli.
- **Batas ukuran**: area query umumnya kecil (level kelurahan/proyek). Cukup pasang
  timeout query di server untuk melindungi DB bila suatu area sangat padat.
- **Idempotent**: query bersifat read-only; aman untuk retry.
