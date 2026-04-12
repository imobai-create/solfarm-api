import { FastifyInstance } from 'fastify'
import {
  getWallet, requestTokenEmission, transferTokens,
  registerEnergyCredit, getTransactions, getLeaderboard,
} from './farmcoin.service'

export async function farmcoinRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate)

  // GET /farmcoin/wallet — saldo e resumo
  fastify.get('/wallet', async (req: any, reply) => {
    const data = await getWallet(req.user.sub)
    return reply.send(data)
  })

  // GET /farmcoin/transactions — histórico
  fastify.get('/transactions', async (req: any, reply) => {
    const { page } = req.query as { page?: string }
    const data = await getTransactions(req.user.sub, Number(page ?? 1))
    return reply.send(data)
  })

  // POST /farmcoin/request — solicita emissão de tokens (lastro = produção)
  fastify.post('/request', async (req: any, reply) => {
    const { areaId, culture, declaredProduction, productionUnit, ndvi } = req.body as any
    if (!areaId || !culture || !declaredProduction) {
      return reply.status(400).send({ error: 'areaId, culture e declaredProduction são obrigatórios' })
    }
    try {
      const result = await requestTokenEmission(req.user.sub, {
        areaId, culture, declaredProduction, productionUnit, ndvi,
      })
      return reply.send(result)
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  // POST /farmcoin/transfer — transferência P2P
  fastify.post('/transfer', async (req: any, reply) => {
    const { toUserId, amount, description } = req.body as any
    if (!toUserId || !amount) {
      return reply.status(400).send({ error: 'toUserId e amount são obrigatórios' })
    }
    try {
      const result = await transferTokens(req.user.sub, toUserId, amount, description)
      return reply.send(result)
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  // POST /farmcoin/energy — registra crédito de energia solar
  fastify.post('/energy', async (req: any, reply) => {
    const { kwh, month, source } = req.body as any
    if (!kwh || !month) {
      return reply.status(400).send({ error: 'kwh e month são obrigatórios' })
    }
    try {
      const result = await registerEnergyCredit(req.user.sub, { kwh, month, source })
      return reply.send(result)
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  // GET /farmcoin/leaderboard — top holders (público dentro da auth)
  fastify.get('/leaderboard', async (_req, reply) => {
    const data = await getLeaderboard()
    return reply.send({ leaderboard: data })
  })
}
