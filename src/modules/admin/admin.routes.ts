import { FastifyInstance } from 'fastify'
import { prisma } from '../../config/database'

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate)

  // Verifica se é admin
  fastify.addHook('preHandler', async (request: any, reply) => {
    if (request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Acesso restrito a administradores' })
    }
  })

  // GET /admin/stats — métricas gerais
  fastify.get('/stats', async (_request, reply) => {
    const [
      totalUsers,
      totalAreas,
      totalDiagnostics,
      planCounts,
      recentUsers,
      recentDiagnostics,
      topAreas,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.area.count(),
      prisma.diagnostic.count(),
      prisma.user.groupBy({ by: ['plan'], _count: { plan: true } }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, name: true, email: true, plan: true, role: true, createdAt: true, city: true, state: true },
      }),
      prisma.diagnostic.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          area: { select: { name: true, hectares: true } },
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.area.findMany({
        orderBy: { hectares: 'desc' },
        take: 5,
        include: { user: { select: { name: true } } },
      }),
    ])

    // Receita estimada (planos)
    const planPrices: Record<string, number> = { FREE: 0, CAMPO: 49, FAZENDA: 149 }
    const mrr = planCounts.reduce((acc, p) => {
      return acc + (planPrices[p.plan] ?? 0) * p._count.plan
    }, 0)

    // Usuários por dia nos últimos 7 dias
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const usersLast7 = await prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } })
    const diagsLast7 = await prisma.diagnostic.count({ where: { createdAt: { gte: sevenDaysAgo } } })

    return reply.send({
      overview: {
        totalUsers,
        totalAreas,
        totalDiagnostics,
        mrr,
        usersLast7Days: usersLast7,
        diagsLast7Days: diagsLast7,
      },
      plans: planCounts.map(p => ({ plan: p.plan, count: p._count.plan, revenue: (planPrices[p.plan] ?? 0) * p._count.plan })),
      recentUsers,
      recentDiagnostics: recentDiagnostics.map(d => ({
        id: d.id,
        area: d.area?.name,
        hectares: d.area?.hectares,
        user: d.user?.name,
        score: d.score,
        healthStatus: d.healthStatus,
        createdAt: d.createdAt,
      })),
      topAreas: topAreas.map(a => ({ name: a.name, hectares: a.hectares, owner: a.user?.name })),
    })
  })

  // GET /admin/users — lista todos usuários
  fastify.get('/users', async (request, reply) => {
    const { page = '1', limit = '20' } = request.query as any
    const skip = (Number(page) - 1) * Number(limit)

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, email: true, plan: true, role: true,
          createdAt: true, city: true, state: true, phone: true,
          _count: { select: { areas: true, diagnostics: true } },
        },
      }),
      prisma.user.count(),
    ])

    return reply.send({ users, total, page: Number(page), limit: Number(limit) })
  })
}
