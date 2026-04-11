import { prisma } from '../../config/database'
import { ForbiddenError, NotFoundError, AppError } from '../../shared/errors/AppError'
import type { CreateAreaInput, UpdateAreaInput, ListAreasQuery } from './areas.schemas'
import type { Polygon } from 'geojson'
import { calculateGeoData } from '../../shared/utils/geo.utils'

export class AreasService {

  // ─────────────────────────────────────
  // Criar área com cálculo geoespacial
  // ─────────────────────────────────────
  async create(userId: string, data: CreateAreaInput) {
    // Verifica limite do plano FREE (1 área)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundError('Usuário')

    if (user.plan === 'FREE') {
      const count = await prisma.area.count({ where: { userId, isActive: true } })
      if (count >= 1) {
        throw new AppError(
          'Plano Grátis permite apenas 1 área. Faça upgrade para o Plano Campo.',
          403,
          'PLAN_LIMIT_EXCEEDED'
        )
      }
    }

    if (user.plan === 'CAMPO') {
      const count = await prisma.area.count({ where: { userId, isActive: true } })
      if (count >= 5) {
        throw new AppError(
          'Plano Campo permite até 5 áreas. Faça upgrade para o Plano Fazenda.',
          403,
          'PLAN_LIMIT_EXCEEDED'
        )
      }
    }

    const polygonStr = JSON.stringify(data.polygon)

    // Calcula hectares, centroide e bbox via utilitário JS (sem dependência PostGIS)
    const { hectares, centroid_lat, centroid_lng, bbox } = calculateGeoData(data.polygon as any)

    // Valida tamanho mínimo (0.5 ha = 5000 m²)
    if (hectares < 0.5) {
      throw new AppError('Área mínima é de 0,5 hectares', 400, 'AREA_TOO_SMALL')
    }

    // Valida tamanho máximo no plano FREE (50 ha)
    if (user.plan === 'FREE' && hectares > 50) {
      throw new AppError(
        'Plano Grátis suporta áreas de até 50 hectares',
        403,
        'PLAN_LIMIT_EXCEEDED'
      )
    }

    const area = await prisma.area.create({
      data: {
        name: data.name,
        description: data.description,
        culture: data.culture as any,
        soilType: data.soilType,
        polygon: polygonStr,
        centroidLat: centroid_lat,
        centroidLng: centroid_lng,
        bbox: bbox,
        hectares: Math.round(hectares * 100) / 100,
        state: data.state,
        city: data.city,
        biome: data.biome as any,
        userId,
      },
      include: {
        _count: { select: { diagnostics: true, satelliteImages: true } },
      },
    })

    return {
      ...area,
      polygon: JSON.parse(area.polygon) as Polygon,
      bbox: area.bbox ? JSON.parse(area.bbox) : null,
    }
  }

  // ─────────────────────────────────────
  // Listar áreas do usuário
  // ─────────────────────────────────────
  async list(userId: string, query: ListAreasQuery) {
    const { page, limit, culture, state, biome } = query
    const skip = (page - 1) * limit

    const where = {
      userId,
      isActive: true,
      ...(culture && { culture: culture as any }),
      ...(state && { state }),
      ...(biome && { biome: biome as any }),
    }

    const [areas, total] = await Promise.all([
      prisma.area.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          hectares: true,
          culture: true,
          soilType: true,
          state: true,
          city: true,
          biome: true,
          centroidLat: true,
          centroidLng: true,
          isActive: true,
          createdAt: true,
          _count: { select: { diagnostics: true, satelliteImages: true } },
          // Pega o diagnóstico mais recente
          diagnostics: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              score: true,
              healthStatus: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.area.count({ where }),
    ])

    return {
      data: areas.map(a => ({
        ...a,
        latestDiagnostic: a.diagnostics[0] ?? null,
        diagnostics: undefined,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  // ─────────────────────────────────────
  // Detalhe de uma área
  // ─────────────────────────────────────
  async findOne(userId: string, areaId: string) {
    const area = await prisma.area.findUnique({
      where: { id: areaId },
      include: {
        diagnostics: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            score: true,
            healthStatus: true,
            problems: true,
            recommendations: true,
            recommendedCultures: true,
            yieldEstimate: true,
            createdAt: true,
            satelliteImage: {
              select: { acquisitionDate: true, ndviMean: true, cloudCover: true },
            },
          },
        },
        satelliteImages: {
          take: 3,
          orderBy: { acquisitionDate: 'desc' },
          select: {
            id: true,
            acquisitionDate: true,
            satellite: true,
            cloudCover: true,
            ndviMean: true,
            ndreMean: true,
            ndwiMean: true,
            thumbnailUrl: true,
            status: true,
          },
        },
        _count: { select: { diagnostics: true, satelliteImages: true } },
      },
    })

    if (!area) throw new NotFoundError('Área')
    if (area.userId !== userId) throw new ForbiddenError()

    // Parse dos JSONs
    const diagnosticsFormatted = area.diagnostics.map(d => ({
      ...d,
      problems: d.problems ? JSON.parse(d.problems) : [],
      recommendations: d.recommendations ? JSON.parse(d.recommendations) : [],
      recommendedCultures: d.recommendedCultures
        ? JSON.parse(d.recommendedCultures)
        : [],
    }))

    return {
      ...area,
      polygon: JSON.parse(area.polygon) as Polygon,
      bbox: area.bbox ? JSON.parse(area.bbox) : null,
      diagnostics: diagnosticsFormatted,
    }
  }

  // ─────────────────────────────────────
  // Atualizar área
  // ─────────────────────────────────────
  async update(userId: string, areaId: string, data: UpdateAreaInput) {
    const existing = await prisma.area.findUnique({ where: { id: areaId } })
    if (!existing) throw new NotFoundError('Área')
    if (existing.userId !== userId) throw new ForbiddenError()

    const area = await prisma.area.update({
      where: { id: areaId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.culture && { culture: data.culture as any }),
        ...(data.soilType !== undefined && { soilType: data.soilType }),
        ...(data.state && { state: data.state }),
        ...(data.city && { city: data.city }),
        ...(data.biome && { biome: data.biome as any }),
      },
    })

    return {
      ...area,
      polygon: JSON.parse(area.polygon) as Polygon,
    }
  }

  // ─────────────────────────────────────
  // Deletar área (soft delete)
  // ─────────────────────────────────────
  async delete(userId: string, areaId: string) {
    const existing = await prisma.area.findUnique({ where: { id: areaId } })
    if (!existing) throw new NotFoundError('Área')
    if (existing.userId !== userId) throw new ForbiddenError()

    await prisma.area.update({
      where: { id: areaId },
      data: { isActive: false },
    })

    return { message: 'Área removida com sucesso' }
  }

  // ─────────────────────────────────────
  // Estatísticas do usuário
  // ─────────────────────────────────────
  async stats(userId: string) {
    const areas = await prisma.area.findMany({
      where: { userId, isActive: true },
      select: { hectares: true, culture: true, biome: true },
    })

    const totalHectares = areas.reduce((sum, a) => sum + a.hectares, 0)
    const cultureBreakdown = areas.reduce((acc, a) => {
      const key = a.culture ?? 'VAZIO'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    const diagnosticsCount = await prisma.diagnostic.count({ where: { userId } })

    return {
      totalAreas: areas.length,
      totalHectares: Math.round(totalHectares * 100) / 100,
      cultureBreakdown,
      diagnosticsRun: diagnosticsCount,
    }
  }
}
