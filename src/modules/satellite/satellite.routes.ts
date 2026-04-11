import type { FastifyInstance } from 'fastify'
import { SatelliteService } from './satellite.service'
import { AppError } from '../../shared/errors/AppError'
import { z } from 'zod'

const searchQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  maxCloudCover: z.coerce.number().min(0).max(100).optional(),
  limit: z.coerce.number().min(1).max(10).optional(),
})

export async function satelliteRoutes(fastify: FastifyInstance) {
  const satelliteService = new SatelliteService()

  fastify.addHook('onRequest', fastify.authenticate)

  // GET /satellite/areas/:areaId/search
  // Busca imagens disponíveis para a área (sem processar)
  fastify.get('/areas/:areaId/search', async (request, reply) => {
    const { areaId } = request.params as { areaId: string }
    const query = searchQuerySchema.safeParse(request.query)

    if (!query.success) {
      return reply.status(422).send({ error: 'Query inválida' })
    }

    try {
      const result = await satelliteService.searchImages(
        areaId,
        request.user.sub,
        query.data
      )
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // POST /satellite/areas/:areaId/process
  // Processa uma imagem específica e salva os índices
  fastify.post('/areas/:areaId/process', async (request, reply) => {
    const { areaId } = request.params as { areaId: string }
    const body = z.object({ stacItemId: z.string() }).safeParse(request.body)

    if (!body.success) {
      return reply.status(422).send({ error: 'stacItemId é obrigatório' })
    }

    try {
      const image = await satelliteService.processImage(
        areaId,
        request.user.sub,
        body.data.stacItemId
      )
      return reply.status(201).send({
        message: 'Imagem de satélite processada com sucesso',
        image,
      })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // GET /satellite/areas/:areaId/latest
  // Retorna a última imagem processada da área
  fastify.get('/areas/:areaId/latest', async (request, reply) => {
    const { areaId } = request.params as { areaId: string }

    const { prisma } = await import('../../config/database')

    const image = await prisma.satelliteImage.findFirst({
      where: { areaId, status: 'READY' },
      orderBy: { acquisitionDate: 'desc' },
    })

    if (!image) {
      return reply.status(404).send({
        error: 'Nenhuma imagem processada disponível para esta área',
        code: 'NO_SATELLITE_IMAGE',
      })
    }

    return reply.send({
      image: {
        ...image,
        zonesMap: image.zonesMap ? JSON.parse(image.zonesMap) : null,
      },
    })
  })

  // GET /satellite/areas/:areaId/history
  // Histórico de imagens da área
  fastify.get('/areas/:areaId/history', async (request, reply) => {
    const { areaId } = request.params as { areaId: string }
    const { prisma } = await import('../../config/database')

    const images = await prisma.satelliteImage.findMany({
      where: { areaId },
      orderBy: { acquisitionDate: 'desc' },
      take: 20,
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
        createdAt: true,
      },
    })

    return reply.send({ images })
  })
}
