import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { paymentWebhookRoutes } from './payment.routes'

vi.mock('../../config/database', () => ({
  prisma: {
    user: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}))

vi.mock('../../config/env', () => ({
  env: {
    ASAAS_WEBHOOK_TOKEN: 'token-secreto-123',
    NODE_ENV: 'test',
  },
}))

vi.mock('./asaas.service', () => ({
  PLANOS: {},
  getOrCreateCustomer: vi.fn(),
  createPixPayment: vi.fn(),
  createBoletoPayment: vi.fn(),
  createSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  getPixQrCode: vi.fn(),
  getPaymentStatus: vi.fn(),
}))

async function buildApp() {
  const app = Fastify()
  await app.register(paymentWebhookRoutes)
  await app.ready()
  return app
}

describe('Webhook Asaas — validação de token', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      payload: { event: 'PAYMENT_CONFIRMED', payment: {} },
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 com token incorreto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      headers: { 'asaas-access-token': 'token-errado' },
      payload: { event: 'PAYMENT_CONFIRMED', payment: {} },
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 200 com token correto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      headers: { 'asaas-access-token': 'token-secreto-123' },
      payload: { event: 'PAYMENT_CONFIRMED', payment: { customer: 'cus_123', externalReference: 'plano-campo-123' } },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ received: true })
  })

  it('aceita token via header x-webhook-token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      headers: { 'x-webhook-token': 'token-secreto-123' },
      payload: { event: 'PAYMENT_OVERDUE', payment: { customer: 'cus_123' } },
    })
    expect(res.statusCode).toBe(200)
  })
})
