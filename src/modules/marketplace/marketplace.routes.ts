import type { FastifyInstance } from 'fastify'
import { prisma } from '../../config/database'

export async function marketplaceRoutes(fastify: FastifyInstance) {

  // ─── GET /marketplace/products ─── lista produtos com filtros
  fastify.get('/products', async (req, reply) => {
    const { category, search, state, page = '1', limit = '20' } = req.query as any
    const skip = (Number(page) - 1) * Number(limit)

    const where: any = { isActive: true }
    if (category) where.category = category
    if (state) where.state = state
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: Number(limit),
      }),
      prisma.product.count({ where }),
    ])

    return reply.send({ products, total, page: Number(page), limit: Number(limit) })
  })

  // ─── GET /marketplace/products/:id ─── detalhe do produto
  fastify.get('/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const product = await prisma.product.findUnique({ where: { id } })
    if (!product || !product.isActive) {
      return reply.status(404).send({ message: 'Produto não encontrado' })
    }
    return reply.send(product)
  })

  // ─── POST /marketplace/products ─── criar produto (autenticado)
  fastify.post('/products', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub
    const { name, description, category, price, unit, stock, brand, state, city } = req.body as any

    if (!name || !category || !price || !unit) {
      return reply.status(400).send({ message: 'name, category, price e unit são obrigatórios' })
    }

    const validCategories = ['FERTILIZANTE','DEFENSIVO','SEMENTE','INOCULANTE','MAQUINA','IMPLEMENTO','FERRAMENTA','IRRIGACAO','SERVICO','OUTRO']
    if (!validCategories.includes(category)) {
      return reply.status(400).send({ message: 'Categoria inválida' })
    }

    const parsedPrice = Number(price)
    const parsedStock = Number(stock ?? 0)

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return reply.status(400).send({ message: 'Preço deve ser um número maior que zero' })
    }
    if (isNaN(parsedStock) || parsedStock < 0) {
      return reply.status(400).send({ message: 'Estoque não pode ser negativo' })
    }

    const product = await prisma.product.create({
      data: {
        name,
        description,
        category,
        price: parsedPrice,
        unit,
        stock: parsedStock,
        brand,
        state,
        city,
        supplierId: userId,
        images: [],
      },
    })

    return reply.status(201).send(product)
  })

  // ─── POST /marketplace/orders ─── criar pedido (autenticado)
  fastify.post('/orders', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub
    const { items, paymentMethod } = req.body as {
      items: { productId: string; quantity: number }[]
      paymentMethod?: string
    }

    if (!items || items.length === 0) {
      return reply.status(400).send({ message: 'Informe pelo menos um item' })
    }

    // Busca todos os produtos
    const productIds = items.map(i => i.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    })

    if (products.length !== productIds.length) {
      return reply.status(400).send({ message: 'Um ou mais produtos não encontrados' })
    }

    // Valida estoque disponível
    for (const item of items) {
      const product = products.find(p => p.id === item.productId)!
      if (item.quantity <= 0) {
        return reply.status(400).send({ message: `Quantidade inválida para o produto "${product.name}"` })
      }
      if (product.stock < item.quantity) {
        return reply.status(400).send({
          message: `Estoque insuficiente para "${product.name}". Disponível: ${product.stock}, solicitado: ${item.quantity}`,
        })
      }
    }

    // Calcula total
    let total = 0
    const orderItems = items.map(item => {
      const product = products.find(p => p.id === item.productId)!
      total += product.price * item.quantity
      return { productId: item.productId, quantity: item.quantity, price: product.price }
    })

    // Cria pedido e decrementa estoque atomicamente
    const order = await prisma.$transaction(async (tx) => {
      for (const item of orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        })
      }
      return tx.order.create({
        data: {
          userId,
          total,
          paymentMethod,
          status: 'PENDING',
          items: { create: orderItems },
        },
        include: { items: { include: { product: true } } },
      })
    })

    return reply.status(201).send(order)
  })

  // ─── GET /marketplace/orders ─── pedidos do usuário
  fastify.get('/orders', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub
    const orders = await prisma.order.findMany({
      where: { userId },
      include: { items: { include: { product: { select: { name: true, unit: true, images: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return reply.send({ orders })
  })
}
