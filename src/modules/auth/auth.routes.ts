import type { FastifyInstance } from 'fastify'
import { AuthService } from './auth.service'
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
} from './auth.schemas'
import { AppError } from '../../shared/errors/AppError'

export async function authRoutes(fastify: FastifyInstance) {
  const authService = new AuthService(fastify)

  // POST /auth/register
  fastify.post('/register', async (request, reply) => {
    const body = registerSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(422).send({
        error: 'Dados inválidos',
        details: body.error.flatten().fieldErrors,
      })
    }

    try {
      const result = await authService.register(body.data)
      return reply.status(201).send({
        message: 'Cadastro realizado com sucesso! Bem-vindo ao SolFarm.',
        ...result,
      })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // POST /auth/login
  fastify.post('/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(422).send({
        error: 'Dados inválidos',
        details: body.error.flatten().fieldErrors,
      })
    }

    try {
      const result = await authService.login(body.data)
      return reply.send({
        message: 'Login realizado com sucesso',
        ...result,
      })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // POST /auth/refresh
  fastify.post('/refresh', async (request, reply) => {
    const body = refreshTokenSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(422).send({ error: 'refreshToken é obrigatório' })
    }

    try {
      const result = await authService.refresh(body.data.refreshToken)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // POST /auth/logout (autenticado)
  fastify.post('/logout', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const result = await authService.logout(request.user.sub)
    return reply.send(result)
  })

  // GET /auth/me (autenticado)
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const user = await authService.me(request.user.sub)
      return reply.send({ user })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })
}
