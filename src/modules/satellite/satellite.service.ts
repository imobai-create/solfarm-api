import axios from 'axios'
import { env } from '../../config/env'
import { prisma } from '../../config/database'
import { ExternalServiceError, NotFoundError, ForbiddenError } from '../../shared/errors/AppError'
import type { Polygon, BBox } from 'geojson'

// ─────────────────────────────────────────────────────────────
// STAC API — Element84 Earth Search (GRATUITO, sem chave)
// Docs: https://earth-search.aws.element84.com/v1
// Sentinel-2 Level 2A — resolução 10m — revisita ~5 dias
// ─────────────────────────────────────────────────────────────

interface STACItem {
  id: string
  type: string
  geometry: Polygon
  bbox: number[]
  properties: {
    datetime: string
    'eo:cloud_cover': number
    platform: string
    'proj:epsg': number
    's2:mgrs_tile': string
    's2:processing_baseline': string
    'created': string
  }
  assets: {
    red: { href: string; type: string }        // Banda B04 (Red)
    nir: { href: string; type: string }         // Banda B08 (NIR)
    'nir08': { href: string; type: string }     // Banda B8A (Red-Edge)
    green: { href: string; type: string }       // Banda B03 (Green)
    'visual': { href: string; type: string }    // True Color RGB
    thumbnail: { href: string; type: string }
    overview: { href: string; type: string }
  }
  links: { rel: string; href: string }[]
}

interface STACSearchResponse {
  type: string
  features: STACItem[]
  context?: { returned: number; matched: number }
}

export class SatelliteService {

  // ─────────────────────────────────────────────────────────────
  // Busca imagens Sentinel-2 disponíveis para uma área
  // ─────────────────────────────────────────────────────────────
  async searchImages(areaId: string, userId: string, options?: {
    dateFrom?: string
    dateTo?: string
    maxCloudCover?: number
    limit?: number
  }) {
    const area = await prisma.area.findUnique({ where: { id: areaId } })
    if (!area) throw new NotFoundError('Área')
    if (area.userId !== userId) throw new ForbiddenError()

    const bbox = area.bbox ? JSON.parse(area.bbox) : null
    if (!bbox) throw new ExternalServiceError('STAC', 'Área sem bbox calculado')

    // Defaults: últimos 30 dias, máximo 20% nuvem
    const dateTo = options?.dateTo ?? new Date().toISOString().split('T')[0]
    const dateFrom = options?.dateFrom ?? (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return d.toISOString().split('T')[0]
    })()

    const maxCloudCover = options?.maxCloudCover ?? 20
    const limit = options?.limit ?? 5

    try {
      // Extrai bbox do GeoJSON Envelope {type:Polygon, coordinates:[...]}
      const bboxGeom = this.extractBBox(bbox)

      const response = await axios.post<STACSearchResponse>(
        `${env.STAC_API_URL}/search`,
        {
          collections: ['sentinel-2-l2a'],
          bbox: bboxGeom,
          datetime: `${dateFrom}T00:00:00Z/${dateTo}T23:59:59Z`,
          query: {
            'eo:cloud_cover': { lte: maxCloudCover },
          },
          limit,
          sortby: [{ field: 'properties.datetime', direction: 'desc' }],
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      )

      const items = response.data.features

      return {
        total: items.length,
        area: { id: area.id, name: area.name, hectares: area.hectares },
        images: items.map(item => ({
          stacId: item.id,
          acquisitionDate: item.properties.datetime,
          cloudCover: item.properties['eo:cloud_cover'],
          satellite: item.properties.platform ?? 'Sentinel-2',
          thumbnailUrl: item.assets.thumbnail?.href ?? item.assets.overview?.href,
          trueColorUrl: item.assets.visual?.href,
          bbox: item.bbox,
          mgrs: item.properties['s2:mgrs_tile'],
        })),
      }
    } catch (err: any) {
      if (err.response) {
        throw new ExternalServiceError('Sentinel-2 STAC', `Erro ${err.response.status}: ${err.response.data?.description}`)
      }
      throw new ExternalServiceError('Sentinel-2 STAC', err.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Processa uma imagem e calcula índices de vegetação
  // Usa Cloud Optimized GeoTIFFs (COG) via georaster
  // ─────────────────────────────────────────────────────────────
  async processImage(areaId: string, userId: string, stacItemId: string) {
    const area = await prisma.area.findUnique({ where: { id: areaId } })
    if (!area) throw new NotFoundError('Área')
    if (area.userId !== userId) throw new ForbiddenError()

    // Cria registro no banco com status PROCESSING
    const satelliteImage = await prisma.satelliteImage.create({
      data: {
        areaId,
        acquisitionDate: new Date(),
        satellite: 'Sentinel-2 L2A',
        cloudCover: 0,
        resolution: 10,
        stacItemId,
        status: 'PROCESSING',
      },
    })

    try {
      // Busca metadados do item STAC
      const itemResponse = await axios.get<STACItem>(
        `${env.STAC_API_URL}/collections/sentinel-2-l2a/items/${stacItemId}`,
        { timeout: 10000 }
      )

      const item = itemResponse.data
      const acquisitionDate = new Date(item.properties.datetime)
      const cloudCover = item.properties['eo:cloud_cover']

      // Calcula índices usando COG (leitura por janela da área)
      const polygon = JSON.parse(area.polygon) as Polygon
      const bbox = this.bboxFromPolygon(polygon)

      // Usa georaster para ler as bandas remotamente
      const indices = await this.calculateIndices(
        item.assets.red?.href,
        item.assets.nir?.href,
        item.assets['nir08']?.href,
        item.assets.green?.href,
        bbox
      )

      // Atualiza com resultados calculados
      const updated = await prisma.satelliteImage.update({
        where: { id: satelliteImage.id },
        data: {
          acquisitionDate,
          cloudCover,
          ndviMean: indices.ndvi.mean,
          ndviMin: indices.ndvi.min,
          ndviMax: indices.ndvi.max,
          ndreMean: indices.ndre?.mean,
          ndwiMean: indices.ndwi?.mean,
          eviMean: indices.evi?.mean,
          zonesMap: JSON.stringify(indices.zones),
          thumbnailUrl: item.assets.thumbnail?.href,
          trueColorUrl: item.assets.visual?.href,
          status: 'READY',
        },
      })

      return updated
    } catch (err: any) {
      // Marca como erro mas mantém o registro
      await prisma.satelliteImage.update({
        where: { id: satelliteImage.id },
        data: { status: 'ERROR' },
      })
      throw new ExternalServiceError('Processamento de Satélite', err.message)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cálculo de índices via georaster (COG)
  // ─────────────────────────────────────────────────────────────
  private async calculateIndices(
    redUrl: string,
    nirUrl: string,
    redEdgeUrl: string,
    greenUrl: string,
    bbox: BBox
  ) {
    // Dynamic import do georaster (módulo ESM)
    const { default: parseGeoraster } = await import('georaster') as any

    // Lê as bandas como COG (apenas a janela da área, não a cena inteira)
    const [redRaster, nirRaster] = await Promise.all([
      parseGeoraster(redUrl),
      parseGeoraster(nirUrl),
    ])

    // Obtém os valores dos pixels na bbox da área
    const redValues = this.extractPixelsInBBox(redRaster, bbox)
    const nirValues = this.extractPixelsInBBox(nirRaster, bbox)

    // NDVI = (NIR - Red) / (NIR + Red)
    const ndviValues = redValues.map((r, i) => {
      const n = nirValues[i]
      if (r === null || n === null) return null
      const denom = n + r
      return denom === 0 ? 0 : (n - r) / denom
    }).filter((v): v is number => v !== null)

    const ndviStats = this.calcStats(ndviValues)

    // Divide a área em zonas (grid 3x3) para mapa de calor
    const zones = this.calculateZonesGrid(redValues, nirValues, bbox)

    // NDRE e NDWI são opcionais (dependem das bandas disponíveis)
    let ndreStats: ReturnType<typeof this.calcStats> | null = null
    let ndwiStats: ReturnType<typeof this.calcStats> | null = null
    let eviStats: ReturnType<typeof this.calcStats> | null = null

    try {
      if (redEdgeUrl) {
        const redEdgeRaster = await parseGeoraster(redEdgeUrl)
        const reValues = this.extractPixelsInBBox(redEdgeRaster, bbox)
        // NDRE = (RedEdge - Red) / (RedEdge + Red)
        const ndreValues = reValues.map((re, i) => {
          const r = redValues[i]
          if (re === null || r === null) return null
          const d = re + r
          return d === 0 ? 0 : (re - r) / d
        }).filter((v): v is number => v !== null)
        ndreStats = this.calcStats(ndreValues)
      }

      if (greenUrl) {
        const greenRaster = await parseGeoraster(greenUrl)
        const gValues = this.extractPixelsInBBox(greenRaster, bbox)
        // NDWI = (Green - NIR) / (Green + NIR)
        const ndwiValues = gValues.map((g, i) => {
          const n = nirValues[i]
          if (g === null || n === null) return null
          const d = g + n
          return d === 0 ? 0 : (g - n) / d
        }).filter((v): v is number => v !== null)
        ndwiStats = this.calcStats(ndwiValues)

        // EVI = 2.5 * (NIR - Red) / (NIR + 6*Red - 7.5*Blue + 1)
        eviStats = this.calcStats(
          nirValues.map((n, i) => {
            const r = redValues[i]
            if (n === null || r === null) return null
            const evi = 2.5 * (n - r) / (n + 6 * r + 1)
            return Math.max(-1, Math.min(1, evi))
          }).filter((v): v is number => v !== null)
        )
      }
    } catch {
      // Não bloqueia se as bandas opcionais falharem
    }

    return {
      ndvi: ndviStats,
      ndre: ndreStats,
      ndwi: ndwiStats,
      evi: eviStats,
      zones,
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Extrai pixels da raster dentro da bbox
  // ─────────────────────────────────────────────────────────────
  private extractPixelsInBBox(raster: any, bbox: BBox): (number | null)[] {
    const values: (number | null)[] = []
    const { data, xmin, xmax, ymin, ymax, pixelWidth, pixelHeight, noDataValue } = raster

    if (!data || !data[0]) return values

    const band = data[0] // primeira banda
    const cols = Math.round((xmax - xmin) / pixelWidth)
    const rows = Math.round((ymax - ymin) / pixelHeight)

    // Coordenadas da bbox em pixels
    const colStart = Math.max(0, Math.floor((bbox[0] - xmin) / pixelWidth))
    const rowStart = Math.max(0, Math.floor((ymax - bbox[3]) / pixelHeight))
    const colEnd = Math.min(cols - 1, Math.ceil((bbox[2] - xmin) / pixelWidth))
    const rowEnd = Math.min(rows - 1, Math.ceil((ymax - bbox[1]) / pixelHeight))

    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const val = band[row]?.[col]
        if (val !== undefined && val !== noDataValue) {
          // Sentinel-2 L2A: valores em reflectância escalonada (0-10000) → normaliza
          values.push(val / 10000)
        } else {
          values.push(null)
        }
      }
    }

    return values
  }

  // ─────────────────────────────────────────────────────────────
  // Cria grid de zonas (3x3 = 9 zonas) para mapa de calor
  // ─────────────────────────────────────────────────────────────
  private calculateZonesGrid(
    redValues: (number | null)[],
    nirValues: (number | null)[],
    bbox: BBox
  ): { zone: string; ndvi: number; lat: number; lng: number; status: string }[] {
    const gridSize = 3
    const zones = []
    const lngStep = (bbox[2] - bbox[0]) / gridSize
    const latStep = (bbox[3] - bbox[1]) / gridSize
    const totalPixels = redValues.length
    const pixelsPerZone = Math.floor(totalPixels / (gridSize * gridSize))

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const zoneIdx = row * gridSize + col
        const start = zoneIdx * pixelsPerZone
        const end = Math.min(start + pixelsPerZone, totalPixels)

        const zoneRed = redValues.slice(start, end)
        const zoneNir = nirValues.slice(start, end)
        const zoneNdvi = zoneRed.map((r, i) => {
          const n = zoneNir[i]
          if (r === null || n === null) return null
          const d = n + r
          return d === 0 ? 0 : (n - r) / d
        }).filter((v): v is number => v !== null)

        const ndviMean = zoneNdvi.length > 0
          ? zoneNdvi.reduce((a, b) => a + b, 0) / zoneNdvi.length
          : 0

        const centerLng = bbox[0] + (col + 0.5) * lngStep
        const centerLat = bbox[1] + (row + 0.5) * latStep

        zones.push({
          zone: `Z${row + 1}${col + 1}`,
          ndvi: Math.round(ndviMean * 1000) / 1000,
          lat: Math.round(centerLat * 10000) / 10000,
          lng: Math.round(centerLng * 10000) / 10000,
          status: this.ndviToStatus(ndviMean),
        })
      }
    }

    return zones
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  private calcStats(values: number[]) {
    if (values.length === 0) return { mean: 0, min: 0, max: 0, std: 0 }
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const min = Math.min(...values)
    const max = Math.max(...values)
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
    return {
      mean: Math.round(mean * 1000) / 1000,
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
    }
  }

  private bboxFromPolygon(polygon: Polygon): BBox {
    const coords = polygon.coordinates[0]
    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
  }

  private extractBBox(bboxGeom: any): number[] {
    // Se for GeoJSON Polygon (ST_AsGeoJSON retorna polygon), extrai bbox
    if (bboxGeom?.coordinates) {
      const coords = bboxGeom.coordinates[0]
      const lngs = coords.map((c: number[]) => c[0])
      const lats = coords.map((c: number[]) => c[1])
      return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
    }
    // Se já for array [minLng, minLat, maxLng, maxLat]
    if (Array.isArray(bboxGeom)) return bboxGeom
    return bboxGeom
  }

  ndviToStatus(ndvi: number): string {
    if (ndvi > 0.7) return 'EXCELENTE'
    if (ndvi > 0.5) return 'BOM'
    if (ndvi > 0.3) return 'REGULAR'
    if (ndvi > 0.1) return 'CRITICO'
    return 'MUITO_RUIM'
  }

  ndviToHealthStatus(ndvi: number): string {
    if (ndvi > 0.7) return 'EXCELENTE'
    if (ndvi > 0.5) return 'BOM'
    if (ndvi > 0.3) return 'REGULAR'
    if (ndvi > 0.1) return 'CRITICO'
    return 'MUITO_RUIM'
  }
}
