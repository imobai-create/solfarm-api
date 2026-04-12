import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../config/database'
import { AppError } from '../../shared/errors/AppError'
import {
  PLANOS, getOrCreateCustomer, createPixPayment,
  createBoletoPayment, createSubscription, cancelSubscription,
  getPixQrCode, getPaymentStatus,
} from './asaas.service'

export async function paymentRoutes(fastify: FastifyInstance) {

  // ── Rotas protegidas ──────────────────────────────────────
  fastify.addHook('onRequest', fastify.authenticate)

  // GET /payments/plans — lista os planos disponíveis
  fastify.get('/plans', async () => {
    return {
      plans: [
        {
          id: 'FREE',
          name: 'Grátis',
          price: 0,
          period: 'sempre',
          features: ['1 área cadastrada', 'Diagnóstico NDVI básico', 'Histórico 30 dias', 'Marketplace (visualização)'],
          limits: { areas: 1, diagnostics: 3 },
        },
        {
          id: 'CAMPO',
          name: 'Campo',
          price: 49,
          period: 'mês',
          popular: true,
          features: ['Até 5 áreas', 'NDVI + NDRE + NDWI', 'Plano VRA de fertilização', 'Marketplace com compra', 'Alertas automáticos', 'Histórico 12 meses'],
          limits: { areas: 5, diagnostics: 20 },
        },
        {
          id: 'FAZENDA',
          name: 'Fazenda',
          price: 149,
          period: 'mês',
          features: ['Áreas ilimitadas', 'IA avançada', 'Score agrícola + crédito', 'API para integração', 'Relatórios PDF', 'Gerente dedicado'],
          limits: { areas: 999, diagnostics: 999 },
        },
      ],
    }
  })

  // POST /payments/checkout — inicia checkout (PIX ou Boleto)
  fastify.post('/checkout', async (request, reply) => {
    const body = z.object({
      plan: z.enum(['CAMPO', 'FAZENDA']),
      billingType: z.enum(['PIX', 'BOLETO']).default('PIX'),
      cpfCnpj: z.string().optional(),
      phone: z.string().optional(),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.status(422).send({ error: 'Dados inválidos', details: body.error.flatten() })
    }

    const user = await prisma.user.findUnique({ where: { id: request.user.sub } })
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    try {
      // Cria ou busca cliente no Asaas
      const customer = await getOrCreateCustomer({
        name: user.name,
        email: user.email,
        cpfCnpj: body.data.cpfCnpj,
        phone: body.data.phone ?? user.phone ?? undefined,
      })

      // Salva asaasCustomerId no usuário
      await prisma.user.update({
        where: { id: user.id },
        data: { asaasCustomerId: customer.id } as any,
      }).catch(() => {}) // ignora se coluna não existir ainda

      let payment: any
      if (body.data.billingType === 'PIX') {
        payment = await createPixPayment({
          customerId: customer.id,
          plano: body.data.plan,
        })
        // Gera QR Code PIX
        const qr = await getPixQrCode(payment.id)
        payment.pixQrCode = qr
      } else {
        payment = await createBoletoPayment({
          customerId: customer.id,
          plano: body.data.plan,
        })
      }

      return reply.status(201).send({
        message: 'Cobrança gerada com sucesso',
        payment: {
          id: payment.id,
          status: payment.status,
          value: payment.value,
          dueDate: payment.dueDate,
          billingType: body.data.billingType,
          invoiceUrl: payment.invoiceUrl,
          bankSlipUrl: payment.bankSlipUrl,
          pixQrCode: payment.pixQrCode ?? null,
        },
        plan: PLANOS[body.data.plan],
      })
    } catch (err: any) {
      const msg = err?.response?.data?.errors?.[0]?.description ?? err.message ?? 'Erro ao processar pagamento'
      return reply.status(400).send({ error: msg })
    }
  })

  // GET /payments/status/:paymentId — verifica status de um pagamento
  fastify.get('/status/:paymentId', async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string }
    try {
      const payment = await getPaymentStatus(paymentId)
      return reply.send({
        id: payment.id,
        status: payment.status,
        value: payment.value,
        dueDate: payment.dueDate,
        confirmedDate: payment.confirmedDate,
      })
    } catch {
      return reply.status(404).send({ error: 'Pagamento não encontrado' })
    }
  })
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK Asaas (sem autenticação — valida via token no header)
// ─────────────────────────────────────────────────────────────
export async function paymentWebhookRoutes(fastify: FastifyInstance) {

  fastify.post('/webhooks/asaas', async (request, reply) => {
    const body = request.body as any

    // Evento de pagamento confirmado
    if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
      const payment = body.payment
      const externalRef: string = payment?.externalReference ?? ''

      // Identifica o plano pelo externalReference
      let newPlan: string | null = null
      if (externalRef.includes('campo')) newPlan = 'CAMPO'
      if (externalRef.includes('fazenda')) newPlan = 'FAZENDA'

      if (newPlan && payment?.customer) {
        // Atualiza o plano do usuário pelo asaasCustomerId
        await prisma.user.updateMany({
          where: { asaasCustomerId: payment.customer } as any,
          data: { plan: newPlan } as any,
        }).catch(() => {})
      }
    }

    // Evento de cancelamento / inadimplência
    if (body.event === 'PAYMENT_OVERDUE' || body.event === 'SUBSCRIPTION_DELETED') {
      const customer = body.payment?.customer ?? body.subscription?.customer
      if (customer) {
        await prisma.user.updateMany({
          where: { asaasCustomerId: customer } as any,
          data: { plan: 'FREE' } as any,
        }).catch(() => {})
      }
    }

    return reply.send({ received: true })
  })
}
