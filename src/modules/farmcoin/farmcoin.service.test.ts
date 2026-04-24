import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../config/database', () => {
  const txMock = {
    wallet: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    tokenTransaction: { create: vi.fn() },
  }
  return {
    prisma: {
      wallet: {
        upsert: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      tokenTransaction: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      area: { findFirst: vi.fn() },
      tokenRequest: { create: vi.fn(), findMany: vi.fn() },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn((fn: any) => fn(txMock)),
      _txMock: txMock,
    },
  }
})

vi.mock('./blockchain.service', () => ({
  isBlockchainEnabled: vi.fn().mockReturnValue(false),
  mintOnChain: vi.fn(),
}))

import { prisma } from '../../config/database'
import { transferTokens, getWallet } from './farmcoin.service'

const walletA = { id: 'wallet-a', userId: 'user-a', balance: 100, lockedBalance: 0, totalMinted: 100, totalBurned: 0, createdAt: new Date(), updatedAt: new Date() }
const walletB = { id: 'wallet-b', userId: 'user-b', balance: 50,  lockedBalance: 0, totalMinted: 50,  totalBurned: 0, createdAt: new Date(), updatedAt: new Date() }
const txMock = (prisma as any)._txMock

describe('FarmCoin — transferTokens', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lança erro ao transferir para si mesmo', async () => {
    await expect(transferTokens('user-a', 'user-a', 10))
      .rejects.toThrow('Não pode transferir para si mesmo')
  })

  it('lança erro para valor <= 0', async () => {
    await expect(transferTokens('user-a', 'user-b', 0))
      .rejects.toThrow('Valor inválido')
    await expect(transferTokens('user-a', 'user-b', -5))
      .rejects.toThrow('Valor inválido')
  })

  it('lança erro por saldo insuficiente', async () => {
    vi.mocked(prisma.wallet.upsert)
      .mockResolvedValueOnce(walletA as any) // fromWallet
      .mockResolvedValueOnce(walletB as any) // toWallet

    await expect(transferTokens('user-a', 'user-b', 200))
      .rejects.toThrow('Saldo insuficiente')
  })

  it('registra balanceAfter correto para remetente e destinatário', async () => {
    vi.mocked(prisma.wallet.upsert)
      .mockResolvedValueOnce(walletA as any)
      .mockResolvedValueOnce(walletB as any)

    txMock.wallet.findUniqueOrThrow
      .mockResolvedValueOnce(walletA) // from dentro da tx
      .mockResolvedValueOnce(walletB) // to dentro da tx
    txMock.wallet.update.mockResolvedValue({})
    txMock.tokenTransaction.create.mockResolvedValue({})

    await transferTokens('user-a', 'user-b', 30)

    const calls = txMock.tokenTransaction.create.mock.calls

    // Transação do remetente (TRANSFER)
    const senderTx = calls.find((c: any) => c[0].data.type === 'TRANSFER')[0].data
    expect(senderTx.balanceBefore).toBe(100)
    expect(senderTx.balanceAfter).toBe(70) // 100 - 30

    // Transação do destinatário (RECEIVE) — era o bug: usava saldo do remetente
    const receiverTx = calls.find((c: any) => c[0].data.type === 'RECEIVE')[0].data
    expect(receiverTx.balanceBefore).toBe(50)   // saldo real do destinatário
    expect(receiverTx.balanceAfter).toBe(80)    // 50 + 30
  })
})

describe('FarmCoin — getWallet', () => {
  it('cria carteira se ainda não existe (upsert)', async () => {
    vi.mocked(prisma.wallet.upsert).mockResolvedValue(walletA as any)
    vi.mocked(prisma.tokenTransaction.findMany).mockResolvedValue([])
    vi.mocked(prisma.tokenRequest.findMany as any).mockResolvedValue([])

    const result = await getWallet('user-a')

    expect(prisma.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a' } })
    )
    expect(result.wallet).toEqual(walletA)
  })
})
