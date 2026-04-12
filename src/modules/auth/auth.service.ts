import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../../config/database'
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../shared/errors/AppError'
import { sendWelcome } from '../notifications/email.service'
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
      { expiresIn: '30d' }
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
