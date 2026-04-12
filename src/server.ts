import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

import { env } from './config/env'
import { authRoutes } from './modules/auth/auth.routes'
import { areasRoutes } from './modules/areas/areas.routes'
import { satelliteRoutes } from './modules/satellite/satellite.routes'
import { diagnosticRoutes } from './modules/diagnostic/diagnostic.routes'
import { paymentRoutes, paymentWebhookRoutes } from './modules/payment/payment.routes'
import { scanRoutes } from './modules/scan/scan.routes'
import { receitaRoutes } from './modules/receita/receita.routes'
import { adminRoutes } from './modules/admin/admin.routes'
import { farmcoinRoutes } from './modules/farmcoin/farmcoin.routes'

// ─────────────────────────────────────
// Instância do Fastify
// ─────────────────────────────────────
const app = Fastify({
  bodyLimit: 15 * 1024 * 1024, // 15MB para suportar imagens base64
  logger: {
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    level: 'info',
  },
})

// ─────────────────────────────────────
// Plugins
// ─────────────────────────────────────
async function registerPlugins() {
  // Segurança
  await app.register(helmet, {
    contentSecurityPolicy: false,
  })

  // CORS
  await app.register(cors, {
    origin: env.NODE_ENV === 'production'
      ? ['https://solfarm.com.br', 'https://app.solfarm.com.br', 'https://solfarm-web.vercel.app', /\.vercel\.app$/]
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  // Rate Limiting
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    errorResponseBuilder: () => ({
      error: 'Muitas requisições. Aguarde um momento.',
      code: 'RATE_LIMIT_EXCEEDED',
    }),
  })

  // JWT
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  })

  // Swagger (documentação da API)
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SolFarm API',
        description: 'API da plataforma SolFarm — Agro Inteligente para Pequenos e Médios Produtores',
        version: '1.0.0',
        contact: {
          name: 'SolFarm',
          url: 'https://solfarm.com.br',
        },
      },
      tags: [
        { name: 'Auth', description: 'Autenticação e perfil' },
        { name: 'Areas', description: 'Gestão de áreas rurais' },
        { name: 'Satellite', description: 'Imagens e índices de satélite' },
        { name: 'Diagnostics', description: 'Diagnósticos agronômicos' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true,
  })
}

// ─────────────────────────────────────
// Decorator: authenticate
// ─────────────────────────────────────
async function registerDecorators() {
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({
        error: 'Token inválido ou expirado. Faça login novamente.',
        code: 'UNAUTHORIZED',
      })
    }
  })
}

// ─────────────────────────────────────
// Rotas
// ─────────────────────────────────────
async function registerRoutes() {
  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    app: 'SolFarm API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  }))

  // Módulos
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(areasRoutes, { prefix: '/areas' })
  await app.register(satelliteRoutes, { prefix: '/satellite' })
  await app.register(diagnosticRoutes, { prefix: '/diagnostics' })
  await app.register(paymentRoutes, { prefix: '/payments' })
  await app.register(paymentWebhookRoutes, { prefix: '/' })
  await app.register(scanRoutes, { prefix: '/scan' })
  await app.register(receitaRoutes, { prefix: '/receita' })
  await app.register(adminRoutes, { prefix: '/admin' })
  await app.register(farmcoinRoutes, { prefix: '/farmcoin' })

  // 404 handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: `Rota ${request.method} ${request.url} não encontrada`,
      code: 'ROUTE_NOT_FOUND',
    })
  })

  // Error handler global
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error)
    reply.status(error.statusCode ?? 500).send({
      error: error.message ?? 'Erro interno do servidor',
      code: 'INTERNAL_ERROR',
    })
  })
}

// ─────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────
async function bootstrap() {
  try {
    console.log('🚀 Iniciando SolFarm API...')
    console.log(`   NODE_ENV: ${process.env.NODE_ENV}`)
    console.log(`   PORT: ${process.env.PORT ?? 3333}`)
    console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✓ definida' : '✗ AUSENTE'}`)

    await registerPlugins()
    await registerDecorators()
    await registerRoutes()

    const port = Number(process.env.PORT) || 3333
    await app.listen({ port, host: '0.0.0.0' })
    console.log(`✅ SolFarm API rodando na porta ${port}`)

    app.log.info(`
╔══════════════════════════════════════════════╗
║          🌿 SolFarm API Iniciada             ║
╠══════════════════════════════════════════════╣
║  Servidor:  http://localhost:${env.PORT}          ║
║  Docs:      http://localhost:${env.PORT}/docs      ║
║  Ambiente:  ${env.NODE_ENV.padEnd(35)}║
╚══════════════════════════════════════════════╝
    `)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

bootstrap()
