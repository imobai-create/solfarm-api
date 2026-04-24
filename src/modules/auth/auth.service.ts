import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../../config/database'
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../shared/errors/AppError'
import { env } from '../../config/env'
import { sendWelcome, sendAccountDeleted } from '../notifications/email.service'
import type { RegisterInput, LoginInput } from './auth.schemas'
import type { FastifyInstance } from 'fastify'

export class AuthService {
  constructor(private readonly fastify: FastifyInstance) {}

  // ─────────────────────────────────────
  // Registro
  // ─────────────────────────────────────
  async register(data: RegisterInput) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (existingUser) {
      throw new ConflictError('E-mail já cadastrado')
    }

    if (data.cpfCnpj) {
      const existingCpf = await prisma.user.findUnique({
        where: { cpfCnpj: data.cpfCnpj },
      })
      if (existingCpf) throw new ConflictError('CPF/CNPJ já cadastrado')
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        phone: data.phone,
        cpfCnpj: data.cpfCnpj,
        state: data.state,
        city: data.city,
        role: data.role as any,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        plan: true,
        createdAt: true,
      },
    })

    const { accessToken, refreshToken } = await this.generateTokens(user)

    // Boas-vindas por email (assíncrono)
    sendWelcome({ toEmail: user.email, toName: user.name }).catch(() => {})

    return { user, accessToken, refreshToken }
  }

  // ─────────────────────────────────────
  // Login
  // ─────────────────────────────────────
  async login(data: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (!user || !user.isActive) {
      throw new UnauthorizedError('E-mail ou senha inválidos')
    }

    const passwordMatch = await bcrypt.compare(data.password, user.password)
    if (!passwordMatch) {
      throw new UnauthorizedError('E-mail ou senha inválidos')
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
    }

    const { accessToken, refreshToken } = await this.generateTokens(safeUser)

    return {
      user: safeUser,
      accessToken,
      refreshToken,
    }
  }

  // ─────────────────────────────────────
  // Refresh Token
  // ─────────────────────────────────────
  async refresh(token: string) {
    const stored = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token inválido ou expirado')
    }

    // Revoga o token atual (rotation)
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    })

    const safeUser = {
      id: stored.user.id,
      name: stored.user.name,
      email: stored.user.email,
      role: stored.user.role,
      plan: stored.user.plan,
    }

    const { accessToken, refreshToken } = await this.generateTokens(safeUser)

    return { accessToken, refreshToken }
  }

  // ─────────────────────────────────────
  // Logout
  // ─────────────────────────────────────
  async logout(userId: string) {
    await prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    })
    return { message: 'Logout realizado com sucesso' }
  }

  // ─────────────────────────────────────
  // Me (perfil do usuário autenticado)
  // ─────────────────────────────────────
  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        cpfCnpj: true,
        avatar: true,
        role: true,
        plan: true,
        planExpiresAt: true,
        state: true,
        city: true,
        region: true,
        isVerified: true,
        createdAt: true,
        _count: {
          select: { areas: true, diagnostics: true, orders: true },
        },
      },
    })

    if (!user) throw new NotFoundError('Usuário')

    return user
  }

  // ─────────────────────────────────────
  // Exclusão de conta (Apple + LGPD)
  // ─────────────────────────────────────
  async deleteAccount(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, wallet: { select: { id: true } } },
    })
    if (!user) throw new NotFoundError('Usuário')

    const walletId = user.wallet?.id

    // Deleta tudo em transação, na ordem correta para evitar violações de FK
    await prisma.$transaction(async (tx) => {
      // 1. Likes em posts do usuário
      await tx.postLike.deleteMany({ where: { userId } })

      // 2. Posts
      await tx.post.deleteMany({ where: { userId } })

      // 3. Diagnósticos
      await tx.diagnostic.deleteMany({ where: { userId } })

      // 4. Imagens de satélite ligadas às áreas do usuário
      const areas = await tx.area.findMany({
        where: { userId },
        select: { id: true },
      })
      const areaIds = areas.map(a => a.id)
      if (areaIds.length > 0) {
        await tx.satelliteImage.deleteMany({ where: { areaId: { in: areaIds } } })
      }

      // 5. Áreas
      await tx.area.deleteMany({ where: { userId } })

      // 6. Itens de pedidos
      const orders = await tx.order.findMany({
        where: { userId },
        select: { id: true },
      })
      const orderIds = orders.map(o => o.id)
      if (orderIds.length > 0) {
        await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
      }

      // 7. Pedidos
      await tx.order.deleteMany({ where: { userId } })

      // 8. Dados da carteira FarmCoin
      if (walletId) {
        await tx.tokenTransaction.deleteMany({ where: { walletId } })
        await tx.tokenRequest.deleteMany({ where: { walletId } })
        await tx.energyCredit.deleteMany({ where: { walletId } })
        await tx.wallet.delete({ where: { id: walletId } })
      }

      // 9. Refresh tokens
      await tx.refreshToken.deleteMany({ where: { userId } })

      // 10. Usuário
      await tx.user.delete({ where: { id: userId } })
    })

    // Email de confirmação (best-effort — não bloqueia se falhar)
    sendAccountDeleted({ toEmail: user.email, toName: user.name }).catch(() => {})

    return { message: 'Conta excluída com sucesso. Todos os seus dados foram removidos.' }
  }

  // ─────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────
  private async generateTokens(user: {
    id: string
    email: string
    name: string
    role: any
    plan: any
  }) {
    const accessToken = this.fastify.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.plan,
      },
      { expiresIn: env.JWT_EXPIRES_IN }
    )

    const rawToken = crypto.randomBytes(64).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias

    await prisma.refreshToken.create({
      data: {
        token: rawToken,
        expiresAt,
        userId: user.id,
      },
    })

    return { accessToken, refreshToken: rawToken }
  }
}
