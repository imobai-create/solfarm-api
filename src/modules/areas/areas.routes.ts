import type { FastifyInstance } from 'fastify'
import { AreasService } from './areas.service'
import {
  createAreaSchema,
  updateAreaSchema,
  listAreasQuerySchema,
} from './areas.schemas'
import { AppError } from '../../shared/errors/AppError'

export async function areasRoutes(fastify: FastifyInstance) {
  const areasService = new AreasService()

  // Todas as rotas exigem autenticação
  fastify.addHook('onRequest', fastify.authenticate)

  // GET /areas
  fastify.get('/', async (request, reply) => {
    const query = listAreasQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.status(422).send({ error: 'Query inválida', details: query.error.flatten() })
    }

    const result = await areasService.list(request.user.sub, query.data)
    return reply.send(result)
  })

  // GET /areas/stats
  fastify.get('/stats', async (request, reply) => {
    const stats = await areasService.stats(request.user.sub)
    return reply.send(stats)
  })

  // GET /areas/:id
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    try {
      const area = await areasService.findOne(request.user.sub, id)
      return reply.send({ area })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // POST /areas
  fastify.post('/', async (request, reply) => {
    const body = createAreaSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(422).send({
        error: 'Dados inválidos',
        details: body.error.flatten().fieldErrors,
      })
    }

    try {
      const area = await areasService.create(request.user.sub, body.data)
      return reply.status(201).send({
        message: `Área "${area.name}" cadastrada com sucesso! (${area.hectares} ha)`,
        area,
      })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // PATCH /areas/:id
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateAreaSchema.safeParse(request.body)

    if (!body.success) {
      return reply.status(422).send({ error: 'Dados inválidos', details: body.error.flatten() })
    }

    try {
      const area = await areasService.update(request.user.sub, id, body.data)
      return reply.send({ message: 'Área atualizada com sucesso', area })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // DELETE /areas/:id
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    try {
      const result = await areasService.delete(request.user.sub, id)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
