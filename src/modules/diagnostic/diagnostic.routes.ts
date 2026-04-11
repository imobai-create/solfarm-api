import type { FastifyInstance } from 'fastify'
import { DiagnosticService } from './diagnostic.service'
import { AppError } from '../../shared/errors/AppError'
import { z } from 'zod'

export async function diagnosticRoutes(fastify: FastifyInstance) {
  const diagnosticService = new DiagnosticService()

  fastify.addHook('onRequest', fastify.authenticate)

  // GET /diagnostics
  // Lista todos os diagnósticos do usuário autenticado
  fastify.get('/', async (request, reply) => {
    try {
      const diagnostics = await diagnosticService.listAll(request.user.sub)
      return reply.send({ diagnostics, total: diagnostics.length })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // POST /diagnostics/generate
  // Gera um novo diagnóstico para uma área
  fastify.post('/generate', async (request, reply) => {
    const body = z.object({
      areaId: z.string().uuid(),
      satelliteImageId: z.string().uuid().optional(),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.status(422).send({ error: 'areaId é obrigatório (UUID)' })
    }

    try {
      const diagnostic = await diagnosticService.generate(
        body.data.areaId,
        request.user.sub,
        body.data.satelliteImageId
      )

      return reply.status(201).send({
        message: 'Diagnóstico gerado com sucesso',
        diagnostic,
      })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // GET /diagnostics/areas/:areaId
  // Lista diagnósticos de uma área
  fastify.get('/areas/:areaId', async (request, reply) => {
    const { areaId } = request.params as { areaId: string }

    try {
      const diagnostics = await diagnosticService.list(areaId, request.user.sub)
      return reply.send({ diagnostics })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // GET /diagnostics/:id
  // Detalhes de um diagnóstico específico
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    try {
      const diagnostic = await diagnosticService.findOne(id, request.user.sub)
      return reply.send({ diagnostic })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
