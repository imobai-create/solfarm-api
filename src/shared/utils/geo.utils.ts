/**
 * Utilitários geoespaciais em JavaScript puro
 * Substitui ST_Area, ST_Centroid, ST_Envelope do PostGIS
 * Fórmulas: Shoelace (área) + baricentro (centróide) em coordenadas esféricas
 */

export interface GeoCalcResult {
  hectares: number
  centroid_lat: number
  centroid_lng: number
  bbox: string // GeoJSON Polygon da bounding box
}

/**
 * Calcula área em m² usando fórmula esférica (aproximação WGS84)
 * Precisão: ~0.5% — suficiente para fins agronômicos
 */
function sphericalArea(coords: [number, number][]): number {
  const EARTH_RADIUS = 6371000 // metros
  const toRad = (d: number) => (d * Math.PI) / 180

  let area = 0
  const n = coords.length
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = coords[i]
    const [lng2, lat2] = coords[(i + 1) % n]
    area +=
      toRad(lng2 - lng1) *
      (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
  }
  return Math.abs((area * EARTH_RADIUS * EARTH_RADIUS) / 2)
}

/**
 * Calcula centróide como baricentro dos vértices
 */
function centroid(coords: [number, number][]): [number, number] {
  // Remove closing vertex se repetido
  const pts =
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1]
      ? coords.slice(0, -1)
      : coords

  const lat = pts.reduce((s, [, lat]) => s + lat, 0) / pts.length
  const lng = pts.reduce((s, [lng]) => s + lng, 0) / pts.length
  return [lng, lat]
}

/**
 * Bounding box como GeoJSON Polygon
 */
function bboxGeoJSON(coords: [number, number][]): string {
  const lngs = coords.map(([lng]) => lng)
  const lats = coords.map(([, lat]) => lat)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [[
      [minLng, minLat], [maxLng, minLat],
      [maxLng, maxLat], [minLng, maxLat],
      [minLng, minLat],
    ]],
  })
}

/**
 * Calcula hectares, centróide e bbox a partir de um GeoJSON Polygon
 */
export function calculateGeoData(polygon: { type: string; coordinates: [number, number][][] }): GeoCalcResult {
  const ring = polygon.coordinates[0] // anel externo (ignoramos buracos)
  const areaM2 = sphericalArea(ring)
  const hectares = areaM2 / 10000
  const [cLng, cLat] = centroid(ring)
  const bbox = bboxGeoJSON(ring)

  return {
    hectares: Math.round(hectares * 100) / 100,
    centroid_lat: cLat,
    centroid_lng: cLng,
    bbox,
  }
}
