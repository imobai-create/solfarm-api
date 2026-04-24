import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

// ── Mocks ───────────────────────────────────────────────────────
vi.mock('../../config/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../../config/env', () => ({
  env: { JWT_EXPIRES_IN: '7d' },
}))

vi.mock('../notifications/email.service', () => ({
  sendWelcome: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '../../config/database'
import { AuthService } from './auth.service'
import { ConflictError, UnauthorizedError } from '../../shared/errors/AppError'

const mockFastify = {
  jwt: {
    sign: vi.fn().mockReturnValue('mock-access-token'),
  },
} as any

const baseUser = {
  id: 'user-uuid',
  name: 'João Silva',
  email: 'joao@solfarm.com.br',
  role: 'PRODUCER',
  plan: 'FREE',
  isActive: true,
  password: '',
  createdAt: new Date(),
}

describe('AuthService', () => {
  let service: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuthService(mockFastify)
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as any)
  })

  // ── register ────────────────────────────────────────────────
  describe('register', () => {
    it('lança ConflictError se e-mail já cadastrado', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(baseUser as any)

      await expect(service.register({
        name: 'João', email: 'joao@solfarm.com.br', password: 'Senha123',
      })).rejects.toThrow(ConflictError)
    })

    it('lança ConflictError se CPF/CNPJ já cadastrado', async () => {
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(null)      // e-mail não existe
        .mockResolvedValueOnce(baseUser as any) // CPF já existe

      await expect(service.register({
        name: 'João', email: 'novo@solfarm.com.br', password: 'Senha123', cpfCnpj: '12345678901',
      })).rejects.toThrow(ConflictError)
    })

    it('cria usuário e retorna accessToken + refreshToken', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.user.create).mockResolvedValue({ ...baseUser, createdAt: new Date() } as any)

      const result = await service.register({
        name: 'João', email: 'joao@solfarm.com.br', password: 'Senha123',
      })

      expect(result.accessToken).toBe('mock-access-token')
      expect(result.refreshToken).toBeDefined()
      expect(typeof result.refreshToken).toBe('string')
      expect(result.refreshToken.length).toBeGreaterThan(32)
    })

    it('faz hash da senha antes de salvar', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      let savedPassword = ''
      vi.mocked(prisma.user.create).mockImplementation(async ({ data }: any) => {
        savedPassword = data.password
        return { ...baseUser } as any
      })

      await service.register({ name: 'João', email: 'j@solfarm.com.br', password: 'Senha123' })

      expect(savedPassword).not.toBe('Senha123')
      expect(await bcrypt.compare('Senha123', savedPassword)).toBe(true)
    })
  })

  // ── login ───────────────────────────────────────────────────
  describe('login', () => {
    it('lança UnauthorizedError para e-mail inexistente', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      await expect(service.login({ email: 'fake@solfarm.com.br', password: 'Senha123' }))
        .rejects.toThrow(UnauthorizedError)
    })

    it('lança UnauthorizedError para usuário inativo', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...baseUser, isActive: false } as any)

      await expect(service.login({ email: 'joao@solfarm.com.br', password: 'Senha123' }))
        .rejects.toThrow(UnauthorizedError)
    })

    it('lança UnauthorizedError para senha incorreta', async () => {
      const hash = await bcrypt.hash('SenhaCorreta123', 12)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...baseUser, password: hash } as any)

      await expect(service.login({ email: 'joao@solfarm.com.br', password: 'SenhaErrada123' }))
        .rejects.toThrow(UnauthorizedError)
    })

    it('retorna tokens para credenciais válidas', async () => {
      const hash = await bcrypt.hash('Senha123', 12)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...baseUser, password: hash } as any)

      const result = await service.login({ email: 'joao@solfarm.com.br', password: 'Senha123' })

      expect(result.accessToken).toBe('mock-access-token')
      expect(result.refreshToken).toBeDefined()
    })
  })

  // ── logout ──────────────────────────────────────────────────
  describe('logout', () => {
    it('revoga todos os refresh tokens do usuário', async () => {
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 2 })

      await service.logout('user-uuid')

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid', isRevoked: false },
        data: { isRevoked: true },
      })
    })
  })
})
