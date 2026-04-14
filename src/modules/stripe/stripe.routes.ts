import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database'
import {
  createStripeCheckout,
  createCustomerPortal,
  constructStripeEvent,
  STRIPE_PLANS,
} from './stripe.service'
import { env } from '../../config/env'

// ─────────────────────────────────────────────────────────────
// ROTAS PROTEGIDAS (requerem JWT)
// ─────────────────────────────────────────────────────────────
export async function stripeRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate)

  // GET /stripe/plans — planos com preços em USD
  fastify.get('/plans', async () => {
    return {
      plans: [
        {
          id: 'FREE',
          name: 'Free',
          priceUSD: 0,
          features: ['1 field', 'Basic NDVI', '30-day history', 'Marketplace (view)'],
        },
        {
          id: 'CAMPO',
          name: 'Campo',
          priceUSD: STRIPE_PLANS.CAMPO.priceUSD / 100,
          priceFormatted: 'US$ 9.99/mo',
          description: STRIPE_PLANS.CAMPO.description,
          features: ['Up to 5 fields', 'NDVI + NDRE + NDWI', 'VRA plan', 'Marketplace', 'Alerts', '12-month history'],
        },
        {
          id: 'FAZENDA',
          name: 'Fazenda',
          priceUSD: STRIPE_PLANS.FAZENDA.priceUSD / 100,
          priceFormatted: 'US$ 29.99/mo',
          description: STRIPE_PLANS.FAZENDA.description,
          features: ['Unlimited fields', 'Advanced AI', 'Agricultural score', 'API access', 'PDF reports', 'Dedicated support'],
        },
      ],
    }
  })

  // POST /stripe/checkout — cria sessão de pagamento Stripe
  fastify.post('/checkout', async (request, reply) => {
    const body = z.object({
      plan: z.enum(['CAMPO', 'FAZENDA']),
      currency: z.enum(['usd', 'eur', 'brl']).default('usd'),
    }).safeParse(request.body)

    if (!body.success) return reply.status(422).send({ error: 'Dados inválidos' })

    if (!env.STRIPE_SECRET_KEY) {
      return reply.status(503).send({ error: 'International payments not available yet. Please use PIX or bank slip.' })
    }

    const user = await prisma.user.findUnique({ where: { id: request.user.sub } })
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    try {
      const baseUrl = env.API_URL?.replace('/api', '') ?? 'https://solfarm.com.br'

      const { url, sessionId } = await createStripeCheckout({
        plan: body.data.plan,
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        currency: body.data.currency,
        successUrl: `${baseUrl}/dashboard/upgrade?success=true`,
        cancelUrl: `${baseUrl}/dashboard/upgrade?canceled=true`,
      })

      return reply.status(201).send({
        checkoutUrl: url,
        sessionId,
        message: 'Redirecione o usuário para checkoutUrl',
      })
    } catch (err: any) {
      return reply.status(400).send({ error: err.message ?? 'Erro ao criar checkout Stripe' })
    }
  })

  // POST /stripe/portal — portal do cliente (cancelar, trocar cartão)
  fastify.post('/portal', async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } })
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    const stripeCustomerId = (user as any).stripeCustomerId
    if (!stripeCustomerId) {
      return reply.status(400).send({ error: 'Nenhuma assinatura Stripe encontrada.' })
    }

    try {
      const baseUrl = env.API_URL?.replace('/api', '') ?? 'https://solfarm.com.br'
      const url = await createCustomerPortal({
        customerId: stripeCustomerId,
        returnUrl: `${baseUrl}/dashboard`,
      })
      return reply.send({ url })
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK STRIPE (sem autenticação — valida via assinatura)
// ─────────────────────────────────────────────────────────────
export async function stripeWebhookRoutes(fastify: FastifyInstance) {

  // Precisa receber o body como Buffer para validar assinatura
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body)
  )

  fastify.post('/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string

    if (!signature) return reply.status(400).send({ error: 'Sem assinatura Stripe' })

    let event: any
    try {
      event = constructStripeEvent(request.body as Buffer, signature)
    } catch (err: any) {
      return reply.status(400).send({ error: `Webhook inválido: ${err.message}` })
    }

    try {
      switch (event.type) {

        // ✅ Pagamento confirmado — ativa o plano
        case 'checkout.session.completed': {
          const session = event.data.object
          const userId = session.metadata?.userId
          const plan = session.metadata?.plan
          const stripeCustomerId = session.customer

          if (userId && plan) {
            await prisma.user.update({
              where: { id: userId },
              data: {
                plan,
                stripeCustomerId,
              } as any,
            }).catch(() => {})
          }
          break
        }

        // ✅ Assinatura renovada — mantém plano ativo
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object
          const customerId = invoice.customer
          if (customerId) {
            const sub = invoice.subscription
            // Busca metadata da subscription para pegar userId
            if (env.STRIPE_SECRET_KEY) {
              const Stripe = (await import('stripe')).default
              const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' })
              const subscription = await stripe.subscriptions.retrieve(sub)
              const userId = subscription.metadata?.userId
              const plan = subscription.metadata?.plan
              if (userId && plan) {
                await prisma.user.update({
                  where: { id: userId },
                  data: { plan } as any,
                }).catch(() => {})
              }
            }
          }
          break
        }

        // ❌ Pagamento falhou — reverte para FREE
        case 'invoice.payment_failed':
        case 'customer.subscription.deleted': {
          const obj = event.data.object
          const customerId = obj.customer
          if (customerId) {
            await prisma.user.updateMany({
              where: { stripeCustomerId: customerId } as any,
              data: { plan: 'FREE' } as any,
            }).catch(() => {})
          }
          break
        }
      }
    } catch (err) {
      console.error('Erro no webhook Stripe:', err)
    }

    return reply.send({ received: true })
  })
}
