import type { FastifyInstance } from 'fastify'
import { AuthService } from './auth.service'
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
} from './auth.schemas'
import { AppError } from '../../shared/errors/AppError'
import { prisma } from '../../config/database'

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

  // PATCH /auth/me — atualiza perfil básico
  fastify.patch('/me', {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { name, phone, state, city } = request.body as any
    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: { ...(name && { name }), ...(phone && { phone }), ...(state && { state }), ...(city && { city }) },
      select: { id: true, name: true, email: true, phone: true, state: true, city: true, plan: true, role: true },
    })
    return reply.send({ user })
  })

  // DELETE /auth/me — exclui conta permanentemente (exigido pela Apple App Store + LGPD)
  fastify.delete('/me', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const result = await authService.deleteAccount(request.user.sub)
      return reply.status(200).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // PATCH /auth/wallet — registra carteira Polygon do produtor
  fastify.patch('/wallet', {
    onRequest: [fastify.authenticate],
  }, async (request: any, reply) => {
    const { walletAddress } = request.body as any

    // Valida formato de endereço Ethereum/Polygon
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return reply.status(422).send({
        error: 'Endereço de carteira inválido. Deve ser um endereço Polygon válido (0x + 40 caracteres hex).',
      })
    }

    try {
      const user = await prisma.user.update({
        where: { id: request.user.sub },
        data: { walletAddress },
        select: { id: true, name: true, walletAddress: true },
      })
      return reply.send({ message: 'Carteira registrada com sucesso!', user })
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Este endereço de carteira já está cadastrado em outra conta.' })
      }
      throw err
    }
  })
}
