import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../config/database', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    area: { count: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('../../shared/utils/geo.utils', () => ({
  calculateGeoData: vi.fn().mockReturnValue({
    hectares: 10,
    centroid_lat: -15.5,
    centroid_lng: -47.5,
    bbox: '{}',
  }),
}))

import { prisma } from '../../config/database'
import { AreasService } from './areas.service'
import { AppError } from '../../shared/errors/AppError'

const samplePolygon = {
  type: 'Polygon',
  coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
}

const areaInput = {
  name: 'Fazenda Teste',
  polygon: samplePolygon as any,
}

describe('AreasService — limites de plano', () => {
  let service: AreasService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AreasService()
    vi.mocked(prisma.area.create).mockResolvedValue({
      id: 'area-uuid', polygon: JSON.stringify(samplePolygon), bbox: null,
      _count: { diagnostics: 0, satelliteImages: 0 },
    } as any)
  })

  it('plano FREE rejeita segunda área', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u', plan: 'FREE' } as any)
    vi.mocked(prisma.area.count).mockResolvedValue(1) // já tem 1

    await expect(service.create('u', areaInput))
      .rejects.toThrow(AppError)

    const err = await service.create('u', areaInput).catch(e => e)
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('PLAN_LIMIT_EXCEEDED')
  })

  it('plano FREE permite primeira área', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u', plan: 'FREE' } as any)
    vi.mocked(prisma.area.count).mockResolvedValue(0)

    await expect(service.create('u', areaInput)).resolves.toBeDefined()
  })

  it('plano CAMPO rejeita sexta área', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u', plan: 'CAMPO' } as any)
    vi.mocked(prisma.area.count).mockResolvedValue(5)

    await expect(service.create('u', areaInput)).rejects.toThrow(AppError)
  })

  it('plano FAZENDA não tem limite', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u', plan: 'FAZENDA' } as any)
    vi.mocked(prisma.area.count).mockResolvedValue(50)

    await expect(service.create('u', areaInput)).resolves.toBeDefined()
  })

  it('rejeita área menor que 0.5 ha', async () => {
    const { calculateGeoData } = await import('../../shared/utils/geo.utils')
    vi.mocked(calculateGeoData).mockReturnValue({ hectares: 0.3, centroid_lat: 0, centroid_lng: 0, bbox: '{}' })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u', plan: 'FAZENDA' } as any)
    vi.mocked(prisma.area.count).mockResolvedValue(0)

    await expect(service.create('u', areaInput)).rejects.toThrow('mínima')
  })
})
