import Stripe from 'stripe'
import { env } from '../../config/env'

// ─────────────────────────────────────────────────────────────
// Stripe Client
// Docs: https://stripe.com/docs/api
// ─────────────────────────────────────────────────────────────

function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY não configurada')
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' })
}

// Planos Stripe (preços em USD para mercado internacional)
export const STRIPE_PLANS = {
  CAMPO: {
    nome: 'Campo',
    priceUSD: 999,      // US$ 9.99/mês
    priceBRL: 4900,     // R$ 49,00/mês (fallback)
    currency: 'usd',
    description: 'SolFarm Campo — up to 5 fields, NDVI + NDRE + NDWI',
    interval: 'month' as const,
  },
  FAZENDA: {
    nome: 'Fazenda',
    priceUSD: 2999,     // US$ 29.99/mês
    priceBRL: 14900,    // R$ 149,00/mês (fallback)
    currency: 'usd',
    description: 'SolFarm Fazenda — unlimited fields, advanced AI, API access',
    interval: 'month' as const,
  },
}

// ─────────────────────────────────────────────────────────────
// CHECKOUT SESSION (hosted payment page — PCI compliant)
// Aceita cartão internacional, Apple Pay, Google Pay
// ─────────────────────────────────────────────────────────────
export async function createStripeCheckout(data: {
  plan: 'CAMPO' | 'FAZENDA'
  userId: string
  userEmail: string
  userName: string
  successUrl: string
  cancelUrl: string
  currency?: 'usd' | 'eur' | 'brl'
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe()
  const plan = STRIPE_PLANS[data.plan]
  const currency = data.currency ?? 'usd'

  // Usa Price ID configurado no Railway, ou cria price inline
  const priceId = data.plan === 'CAMPO'
    ? env.STRIPE_PRICE_CAMPO
    : env.STRIPE_PRICE_FAZENDA

  const lineItems = priceId
    ? [{ price: priceId, quantity: 1 }]
    : [{
        price_data: {
          currency,
          unit_amount: plan.priceUSD,
          recurring: { interval: plan.interval },
          product_data: {
            name: `SolFarm ${plan.nome}`,
            description: plan.description,
            images: ['https://solfarm.com.br/icon.png'],
          },
        },
        quantity: 1,
      }]

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: data.userEmail,
    line_items: lineItems,
    success_url: `${data.successUrl}?session_id={CHECKOUT_SESSION_ID}&plan=${data.plan}`,
    cancel_url: data.cancelUrl,
    metadata: {
      userId: data.userId,
      plan: data.plan,
      userName: data.userName,
    },
    subscription_data: {
      metadata: {
        userId: data.userId,
        plan: data.plan,
      },
    },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    locale: 'auto',
  })

  return { url: session.url!, sessionId: session.id }
}

// ─────────────────────────────────────────────────────────────
// PORTAL DO CLIENTE (cancelar, mudar plano, atualizar cartão)
// ─────────────────────────────────────────────────────────────
export async function createCustomerPortal(data: {
  customerId: string
  returnUrl: string
}): Promise<string> {
  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: data.customerId,
    return_url: data.returnUrl,
  })
  return session.url
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK — valida assinatura e retorna evento
// ─────────────────────────────────────────────────────────────
export function constructStripeEvent(
  payload: Buffer,
  signature: string,
): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET não configurada')
  const stripe = getStripe()
  return stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET)
}

// ─────────────────────────────────────────────────────────────
// BUSCA customer ID no Stripe pelo email
// ─────────────────────────────────────────────────────────────
export async function getStripeCustomerId(email: string): Promise<string | null> {
  const stripe = getStripe()
  const customers = await stripe.customers.list({ email, limit: 1 })
  return customers.data[0]?.id ?? null
}
