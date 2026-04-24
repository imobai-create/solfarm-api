import type { FastifyInstance } from 'fastify'
import { prisma } from '../../config/database'

export async function communityRoutes(fastify: FastifyInstance) {

  // ─── GET /community/posts ─── lista posts com filtros
  fastify.get('/posts', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { category, state, page = '1', limit = '20' } = req.query as any
    const skip = (Number(page) - 1) * Number(limit)

    const where: any = { isActive: true }
    if (category && category !== 'TODOS') where.category = category
    if (state) where.state = state

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, city: true, state: true, plan: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.post.count({ where }),
    ])

    return reply.send({ posts, total })
  })

  // ─── POST /community/posts ─── criar post (autenticado)
  fastify.post('/posts', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub
    const { title, content, category, state, city } = req.body as any

    if (!content || content.trim().length < 5) {
      return reply.status(400).send({ message: 'Conteúdo muito curto (mínimo 5 caracteres)' })
    }

    const validCategories = ['GERAL', 'DUVIDA', 'DICA', 'ALERTA', 'RESULTADO', 'VENDA']
    const postCategory = validCategories.includes(category) ? category : 'GERAL'

    // Busca dados do usuário para preencher localização automaticamente
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { state: true, city: true },
    })

    const post = await prisma.post.create({
      data: {
        userId,
        title,
        content,
        category: postCategory,
        state: state ?? user?.state,
        city: city ?? user?.city,
        images: [],
      },
      include: {
        user: { select: { id: true, name: true, city: true, state: true, plan: true } },
      },
    })

    return reply.status(201).send(post)
  })

  // ─── POST /community/posts/:id/like ─── curtir/descurtir post (toggle)
  fastify.post('/posts/:id/like', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub
    const { id } = req.params as { id: string }

    const post = await prisma.post.findUnique({ where: { id } })
    if (!post) return reply.status(404).send({ message: 'Post não encontrado' })

    const existing = await prisma.postLike.findUnique({
      where: { userId_postId: { userId, postId: id } },
    })

    if (existing) {
      // Descurtir
      const [, updated] = await prisma.$transaction([
        prisma.postLike.delete({ where: { userId_postId: { userId, postId: id } } }),
        prisma.post.update({ where: { id }, data: { likes: { decrement: 1 } } }),
      ])
      return reply.send({ liked: false, likes: Math.max(0, updated.likes) })
    } else {
      // Curtir
      const [, updated] = await prisma.$transaction([
        prisma.postLike.create({ data: { userId, postId: id } }),
        prisma.post.update({ where: { id }, data: { likes: { increment: 1 } } }),
      ])
      return reply.send({ liked: true, likes: updated.likes })
    }
  })

  // ─── DELETE /community/posts/:id ─── deletar próprio post
  fastify.delete('/posts/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub
    const { id } = req.params as { id: string }

    const post = await prisma.post.findUnique({ where: { id } })
    if (!post || !post.isActive) return reply.status(404).send({ message: 'Post não encontrado' })
    if (post.userId !== userId) return reply.status(403).send({ message: 'Sem permissão' })

    await prisma.post.update({ where: { id }, data: { isActive: false } })
    return reply.status(204).send()
  })

  // ─── GET /community/stats ─── estatísticas da comunidade
  fastify.get('/stats', async (_req, reply) => {
    const [totalPosts, totalUsers, recentPosts] = await Promise.all([
      prisma.post.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.post.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ])

    return reply.send({ totalPosts, totalUsers, recentPosts })
  })
}
