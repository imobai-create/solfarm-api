import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),
  API_URL: z.string().default('http://localhost:3333'),

  DATABASE_URL: z.string(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter pelo menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  STAC_API_URL: z.string().default('https://earth-search.aws.element84.com/v1'),

  GOOGLE_MAPS_API_KEY: z.string().optional(),
  COPERNICUS_CLIENT_ID: z.string().optional(),
  COPERNICUS_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Blockchain — Polygon / FARMCOIN
  PLATFORM_PRIVATE_KEY: z.string().optional(),
  TREASURY_WALLET: z.string().optional(),
  FARMCOIN_CONTRACT_ADDRESS: z.string().optional(),
  POLYGON_RPC_URL: z.string().default('https://polygon-bor-rpc.publicnode.com'),

  // Asaas — Pagamentos Brasil
  ASAAS_API_KEY: z.string().optional(),
  ASAAS_SANDBOX: z.string().default('false'),
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),

  // Stripe — Pagamentos Internacionais
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_CAMPO: z.string().optional(),   // price_xxx do plano Campo
  STRIPE_PRICE_FAZENDA: z.string().optional(), // price_xxx do plano Fazenda

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),
})

const _env = envSchema.safeParse(process.env)

if (!_env.success) {
  console.error('❌ Variáveis de ambiente inválidas:')
  console.error(_env.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = _env.data
