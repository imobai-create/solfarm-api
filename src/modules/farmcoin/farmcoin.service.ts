import { prisma } from '../../config/database'
import { mintOnChain, isBlockchainEnabled } from './blockchain.service'

// Preço de referência por saca (em R$) — pode vir de API de cotação no futuro
const PRICE_PER_SACA: Record<string, number> = {
  SOJA: 130,  MILHO: 65, CAFE: 1200, ALGODAO: 150,
  ARROZ: 80,  FEIJAO: 280, TRIGO: 90, CANA: 20,
  OUTRO: 100,
}
const COLLATERAL_RATE = 0.30   // 30% da produção declarada como lastro
const ENERGY_RATE = 0.50       // 0.5 FARMCOIN por kWh excedente

// ── Garante que o usuário tem carteira ────────────────────────
async function ensureWallet(userId: string) {
  return prisma.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  })
}

// ── Credita tokens na carteira (transação interna) ────────────
async function credit(walletId: string, amount: number, type: any, description: string, reference?: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })
  const balanceBefore = wallet.balance
  const balanceAfter = balanceBefore + amount

  await prisma.$transaction([
    prisma.wallet.update({
      where: { id: walletId },
      data: { balance: balanceAfter, totalMinted: { increment: amount } },
    }),
    prisma.tokenTransaction.create({
      data: { walletId, type, amount, description, reference, status: 'CONFIRMED', balanceBefore, balanceAfter },
    }),
  ])
  return balanceAfter
}

// ── Debita tokens da carteira ─────────────────────────────────
async function debit(walletId: string, amount: number, type: any, description: string, reference?: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })
  if (wallet.balance < amount) throw new Error('Saldo insuficiente de FARMCOINS')

  const balanceBefore = wallet.balance
  const balanceAfter = balanceBefore - amount

  await prisma.$transaction([
    prisma.wallet.update({
      where: { id: walletId },
      data: { balance: balanceAfter },
    }),
    prisma.tokenTransaction.create({
      data: { walletId, type, amount, description, reference, status: 'CONFIRMED', balanceBefore, balanceAfter },
    }),
  ])
  return balanceAfter
}

// ── Serviços públicos ─────────────────────────────────────────

export async function getWallet(userId: string) {
  const wallet = await ensureWallet(userId)
  const transactions = await prisma.tokenTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const pendingRequests = await prisma.tokenRequest.findMany({
    where: { walletId: wallet.id, status: { in: ['PENDING', 'APPROVED'] } },
    orderBy: { createdAt: 'desc' },
  })
  return { wallet, transactions, pendingRequests }
}

// ── Solicitar emissão de FARMCOINS (lastro = produção) ────────
export async function requestTokenEmission(userId: string, params: {
  areaId: string
  culture: string
  declaredProduction: number
  productionUnit?: string
  ndvi?: number
}) {
  const wallet = await ensureWallet(userId)

  // Verifica se área pertence ao usuário
  const area = await prisma.area.findFirst({ where: { id: params.areaId, userId } })
  if (!area) throw new Error('Área não encontrada')

  const pricePerUnit = PRICE_PER_SACA[params.culture] ?? 100
  const totalProductionValue = params.declaredProduction * pricePerUnit
  const requestedTokens = Math.floor(totalProductionValue * COLLATERAL_RATE)

  // NDVI valida a produção (NDVI > 0.3 = campo produtivo)
  const ndviValidated = (params.ndvi ?? 0) > 0.3

  const req = await prisma.tokenRequest.create({
    data: {
      walletId: wallet.id,
      areaId: params.areaId,
      culture: params.culture,
      declaredProduction: params.declaredProduction,
      productionUnit: params.productionUnit ?? 'sacas',
      pricePerUnit,
      totalProductionValue,
      collateralRate: COLLATERAL_RATE,
      requestedTokens,
      ndviAtRequest: params.ndvi,
      ndviValidated,
      // Auto-aprova se NDVI valida (fase 1 — auto)
      status: ndviValidated ? 'APPROVED' : 'PENDING',
      approvedAt: ndviValidated ? new Date() : undefined,
    },
  })

  let txHash: string | undefined
  let userTokensOnChain = requestedTokens

  // Se aprovado, emite tokens
  if (req.status === 'APPROVED') {
    // Tenta mint on-chain primeiro se blockchain estiver configurada
    if (isBlockchainEnabled()) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletAddress: true } })
      if (user?.walletAddress) {
        const onchain = await mintOnChain({
          toAddress: user.walletAddress,
          amount: requestedTokens,
          type: 'PRODUCTION',
          ref: req.id,
        })
        if (onchain.success) {
          txHash = onchain.txHash
          userTokensOnChain = onchain.userTokens ?? requestedTokens
        }
      }
    }

    await credit(
      wallet.id,
      userTokensOnChain,
      'MINT',
      `Emissão de ${userTokensOnChain} FARMCOINS — lastro: ${params.declaredProduction} ${params.productionUnit ?? 'sacas'} de ${params.culture}${txHash ? ` | tx: ${txHash}` : ''}`,
      req.id,
    )
  }

  return { request: req, requestedTokens: userTokensOnChain, autoApproved: req.status === 'APPROVED', txHash }
}

// ── Transferência P2P entre produtores ────────────────────────
export async function transferTokens(fromUserId: string, toUserId: string, amount: number, description?: string) {
  if (fromUserId === toUserId) throw new Error('Não pode transferir para si mesmo')
  if (amount <= 0) throw new Error('Valor inválido')

  const fromWallet = await ensureWallet(fromUserId)
  const toWallet = await ensureWallet(toUserId)

  if (fromWallet.balance < amount) throw new Error('Saldo insuficiente de FARMCOINS')

  const desc = description ?? `Transferência de ${amount} FARMCOINS`

  await prisma.$transaction(async (tx) => {
    const [from, to] = await Promise.all([
      tx.wallet.findUniqueOrThrow({ where: { id: fromWallet.id } }),
      tx.wallet.findUniqueOrThrow({ where: { id: toWallet.id } }),
    ])

    await tx.wallet.update({
      where: { id: fromWallet.id },
      data: { balance: { decrement: amount } },
    })
    await tx.wallet.update({
      where: { id: toWallet.id },
      data: { balance: { increment: amount } },
    })
    await tx.tokenTransaction.create({
      data: {
        walletId: fromWallet.id,
        toWalletId: toWallet.id,
        type: 'TRANSFER',
        amount,
        description: `${desc} → para usuário`,
        status: 'CONFIRMED',
        balanceBefore: from.balance,
        balanceAfter: from.balance - amount,
      },
    })
    await tx.tokenTransaction.create({
      data: {
        walletId: toWallet.id,
        toWalletId: fromWallet.id,
        type: 'RECEIVE',
        amount,
        description: `${desc} ← recebido`,
        status: 'CONFIRMED',
        balanceBefore: to.balance,
        balanceAfter: to.balance + amount,
      },
    })
  })

  return { success: true, amount }
}

// ── Registrar crédito de energia solar ────────────────────────
export async function registerEnergyCredit(userId: string, params: {
  kwh: number
  month: string  // "2026-04"
  source?: string
}) {
  const wallet = await ensureWallet(userId)
  const tokensEmitted = Math.floor(params.kwh * ENERGY_RATE)

  const credit_record = await prisma.energyCredit.create({
    data: {
      walletId: wallet.id,
      kwh: params.kwh,
      month: params.month,
      source: params.source ?? 'solar',
      tokensEmitted,
      status: 'VERIFIED',  // fase 1: auto-verifica
      verifiedAt: new Date(),
    },
  })

  // Emite tokens de energia
  await credit(
    wallet.id,
    tokensEmitted,
    'ENERGY_MINT',
    `Emissão de ${tokensEmitted} FARMCOINS — ${params.kwh} kWh solar em ${params.month}`,
    credit_record.id,
  )

  return { credit: credit_record, tokensEmitted }
}

// ── Histórico completo de transações ─────────────────────────
export async function getTransactions(userId: string, page = 1) {
  const wallet = await ensureWallet(userId)
  const skip = (page - 1) * 20

  const [transactions, total] = await Promise.all([
    prisma.tokenTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: 20,
    }),
    prisma.tokenTransaction.count({ where: { walletId: wallet.id } }),
  ])

  return { transactions, total, page, wallet }
}

// ── Ranking de produtores (top holders) ──────────────────────
export async function getLeaderboard() {
  const wallets = await prisma.wallet.findMany({
    where: { balance: { gt: 0 } },
    orderBy: { balance: 'desc' },
    take: 10,
    include: { user: { select: { name: true, city: true, state: true } } },
  })
  return wallets.map(w => ({
    name: w.user.name,
    city: w.user.city,
    state: w.user.state,
    balance: w.balance,
    totalMinted: w.totalMinted,
  }))
}
