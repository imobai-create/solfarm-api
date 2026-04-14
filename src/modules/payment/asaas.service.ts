import axios from 'axios'
import { env } from '../../config/env'

// ─────────────────────────────────────────────────────────────
// Asaas API Client
// Docs: https://docs.asaas.com
// Sandbox: https://sandbox.asaas.com/api/v3
// Produção: https://api.asaas.com/api/v3
// ─────────────────────────────────────────────────────────────

const BASE_URL = env.ASAAS_SANDBOX === 'true'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/api/v3'

const asaas = axios.create({
  baseURL: BASE_URL,
  headers: {
    'access_token': env.ASAAS_API_KEY ?? '',
    'Content-Type': 'application/json',
  },
  timeout: 15000,
})

// ─── Planos ───────────────────────────────────────────────────
export const PLANOS = {
  CAMPO: {
    nome: 'Campo',
    preco: 49.00,
    descricao: 'SolFarm Campo — até 5 áreas, NDVI + NDRE + NDWI, plano VRA',
    ciclo: 'MONTHLY' as const,
  },
  FAZENDA: {
    nome: 'Fazenda',
    preco: 149.00,
    descricao: 'SolFarm Fazenda — áreas ilimitadas, IA avançada, score agrícola + crédito',
    ciclo: 'MONTHLY' as const,
  },
}

// ─── Tipos ────────────────────────────────────────────────────
export interface AsaasCustomer {
  id: string
  name: string
  email: string
  cpfCnpj?: string
  phone?: string
}

export interface AsaasPayment {
  id: string
  status: string
  value: number
  dueDate: string
  invoiceUrl?: string
  bankSlipUrl?: string
  pixQrCode?: {
    encodedImage: string
    payload: string
    expirationDate: string
  }
}

// ─────────────────────────────────────────────────────────────
// CLIENTES
// ─────────────────────────────────────────────────────────────
export async function createCustomer(data: {
  name: string
  email: string
  cpfCnpj?: string
  phone?: string
}): Promise<AsaasCustomer> {
  const res = await asaas.post('/customers', {
    name: data.name,
    email: data.email,
    cpfCnpj: data.cpfCnpj,
    phone: data.phone,
    notificationDisabled: false,
  })
  return res.data
}

export async function findCustomerByEmail(email: string): Promise<AsaasCustomer | null> {
  const res = await asaas.get(`/customers?email=${encodeURIComponent(email)}`)
  const items = res.data.data ?? []
  return items.length > 0 ? items[0] : null
}

export async function getOrCreateCustomer(data: {
  name: string
  email: string
  cpfCnpj?: string
  phone?: string
}): Promise<AsaasCustomer> {
  const existing = await findCustomerByEmail(data.email)
  if (existing) return existing
  return createCustomer(data)
}

// ─────────────────────────────────────────────────────────────
// COBRANÇAS — PIX (pagamento único / mensal manual)
// ─────────────────────────────────────────────────────────────
export async function createPixPayment(data: {
  customerId: string
  plano: keyof typeof PLANOS
  description?: string
}): Promise<AsaasPayment> {
  const plano = PLANOS[data.plano]
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 3) // vence em 3 dias

  const res = await asaas.post('/payments', {
    customer: data.customerId,
    billingType: 'PIX',
    value: plano.preco,
    dueDate: dueDate.toISOString().split('T')[0],
    description: data.description ?? plano.descricao,
    externalReference: `solfarm_${data.plano.toLowerCase()}_${Date.now()}`,
  })

  return res.data
}

export async function createBoletoPayment(data: {
  customerId: string
  plano: keyof typeof PLANOS
}): Promise<AsaasPayment> {
  const plano = PLANOS[data.plano]
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 5)

  const res = await asaas.post('/payments', {
    customer: data.customerId,
    billingType: 'BOLETO',
    value: plano.preco,
    dueDate: dueDate.toISOString().split('T')[0],
    description: plano.descricao,
    externalReference: `solfarm_${data.plano.toLowerCase()}_${Date.now()}`,
  })

  return res.data
}

export async function createCardPayment(data: {
  customerId: string
  plano: keyof typeof PLANOS
  card: {
    holderName: string
    number: string
    expiryMonth: string
    expiryYear: string
    ccv: string
  }
  holderInfo: {
    name: string
    email: string
    cpfCnpj: string
    postalCode: string
    addressNumber: string
    phone: string
  }
}): Promise<AsaasPayment> {
  const plano = PLANOS[data.plano]
  const dueDate = new Date().toISOString().split('T')[0]

  const res = await asaas.post('/payments', {
    customer: data.customerId,
    billingType: 'CREDIT_CARD',
    value: plano.preco,
    dueDate,
    description: plano.descricao,
    externalReference: `solfarm_${data.plano.toLowerCase()}_${Date.now()}`,
    creditCard: data.card,
    creditCardHolderInfo: data.holderInfo,
  })

  return res.data
}

// ─────────────────────────────────────────────────────────────
// ASSINATURAS (recorrência automática)
// ─────────────────────────────────────────────────────────────
export async function createSubscription(data: {
  customerId: string
  plano: keyof typeof PLANOS
  billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED'
  card?: any
  holderInfo?: any
}) {
  const plano = PLANOS[data.plano]
  const nextDueDate = new Date()
  nextDueDate.setDate(nextDueDate.getDate() + 1)

  const res = await asaas.post('/subscriptions', {
    customer: data.customerId,
    billingType: data.billingType,
    value: plano.preco,
    nextDueDate: nextDueDate.toISOString().split('T')[0],
    cycle: plano.ciclo,
    description: plano.descricao,
    externalReference: `solfarm_sub_${data.plano.toLowerCase()}`,
    ...(data.card ? { creditCard: data.card, creditCardHolderInfo: data.holderInfo } : {}),
  })

  return res.data
}

export async function cancelSubscription(subscriptionId: string) {
  await asaas.delete(`/subscriptions/${subscriptionId}`)
}

// ─────────────────────────────────────────────────────────────
// PIX QR CODE (gera após criar cobrança)
// ─────────────────────────────────────────────────────────────
export async function getPixQrCode(paymentId: string) {
  const res = await asaas.get(`/payments/${paymentId}/pixQrCode`)
  return res.data
}

// ─────────────────────────────────────────────────────────────
// STATUS do pagamento
// ─────────────────────────────────────────────────────────────
export async function getPaymentStatus(paymentId: string) {
  const res = await asaas.get(`/payments/${paymentId}`)
  return res.data
}
