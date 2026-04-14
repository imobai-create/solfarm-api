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

  // POST /payments/checkout — inicia checkout (PIX, Boleto ou Cartão)
  // Para cartão: o Asaas gera um link seguro (PCI compliant) — dados do cartão
  // NUNCA passam pelo nosso servidor
  fastify.post('/checkout', async (request, reply) => {
    const body = z.object({
      plan: z.enum(['CAMPO', 'FAZENDA']),
      // UNDEFINED = link que aceita qualquer método (PIX + Cartão + Boleto)
      billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED']).default('UNDEFINED'),
      cpfCnpj: z.string().optional(),
      phone: z.string().optional(),
      // Se true, cria assinatura recorrente (recomendado para planos)
      recurrent: z.boolean().default(true),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.status(422).send({ error: 'Dados inválidos', details: body.error.flatten() })
    }

    const user = await prisma.user.findUnique({ where: { id: request.user.sub } })
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    try {
      const customer = await getOrCreateCustomer({
        name: user.name,
        email: user.email,
        cpfCnpj: body.data.cpfCnpj,
        phone: body.data.phone ?? (user as any).phone ?? undefined,
      })

      await prisma.user.update({
        where: { id: user.id },
        data: { asaasCustomerId: customer.id } as any,
      }).catch(() => {})

      let payment: any
      const billing = body.data.billingType

      if (body.data.recurrent) {
        // ── Assinatura recorrente (débito automático todo mês) ────
        payment = await createSubscription({
          customerId: customer.id,
          plano: body.data.plan,
          billingType: billing === 'UNDEFINED' ? 'UNDEFINED' : billing as any,
        })
      } else if (billing === 'PIX') {
        // ── PIX avulso ────────────────────────────────────────────
        payment = await createPixPayment({ customerId: customer.id, plano: body.data.plan })
        const qr = await getPixQrCode(payment.id)
        payment.pixQrCode = qr
      } else if (billing === 'BOLETO') {
        // ── Boleto avulso ─────────────────────────────────────────
        payment = await createBoletoPayment({ customerId: customer.id, plano: body.data.plan })
      } else {
        // ── Cartão ou link universal (CREDIT_CARD / UNDEFINED) ────
        // Cria cobrança avulsa — Asaas retorna invoiceUrl com página
        // segura onde o cliente digita o cartão diretamente no Asaas
        payment = await createPixPayment({ customerId: customer.id, plano: body.data.plan })
        // Sobrescreve o billingType para o correto
        payment.billingType = billing
      }

      return reply.status(201).send({
        message: 'Cobrança gerada com sucesso',
        payment: {
          id: payment.id,
          status: payment.status ?? 'PENDING',
          value: payment.value ?? PLANOS[body.data.plan].preco,
          dueDate: payment.dueDate ?? payment.nextDueDate,
          billingType: billing,
          recurrent: body.data.recurrent,
          // invoiceUrl = página segura do Asaas (aceita PIX + cartão + boleto)
          invoiceUrl: payment.invoiceUrl ?? null,
          bankSlipUrl: payment.bankSlipUrl ?? null,
          pixQrCode: payment.pixQrCode ?? null,
        },
        plan: PLANOS[body.data.plan],
        // Instrução para o frontend
        action: payment.invoiceUrl
          ? 'redirect' // redireciona para página de pagamento do Asaas
          : billing === 'PIX'
          ? 'show_qrcode' // exibe QR Code PIX
          : 'show_boleto', // exibe boleto
      })
    } catch (err: any) {
      const msg = err?.response?.data?.errors?.[0]?.description ?? err.message ?? 'Erro ao processar pagamento'
      return reply.status(400).send({ error: msg })
    }
  })

  // POST /payments/cancel — cancela assinatura
  fastify.post('/cancel', async (request, reply) => {
    const body = z.object({
      subscriptionId: z.string(),
    }).safeParse(request.body)

    if (!body.success) return reply.status(422).send({ error: 'Dados inválidos' })

    try {
      await cancelSubscription(body.data.subscriptionId)
      await prisma.user.update({
        where: { id: request.user.sub },
        data: { plan: 'FREE' } as any,
      }).catch(() => {})
      return reply.send({ message: 'Assinatura cancelada. Plano revertido para Grátis.' })
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
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
