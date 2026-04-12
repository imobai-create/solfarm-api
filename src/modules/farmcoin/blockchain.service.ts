import { ethers } from 'ethers'
import { env } from '../../config/env'
import farmcoinAbi from './FarmCoin.abi.json'

// ── Configuração da rede Polygon ──────────────────────────────
const POLYGON_RPC = env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com'
const PLATFORM_KEY = env.PLATFORM_PRIVATE_KEY
const CONTRACT_ADDRESS = env.FARMCOIN_CONTRACT_ADDRESS

// MintType enum do contrato
const MintType = { PRODUCTION: 0, ENERGY: 1, BONUS: 2 }

let _provider: ethers.JsonRpcProvider | null = null
let _signer: ethers.Wallet | null = null
let _contract: ethers.Contract | null = null

function getContracts() {
  if (!PLATFORM_KEY || !CONTRACT_ADDRESS) {
    return { ok: false, reason: 'Blockchain não configurada (PLATFORM_PRIVATE_KEY ou FARMCOIN_CONTRACT_ADDRESS ausente)' }
  }
  if (!_contract) {
    _provider = new ethers.JsonRpcProvider(POLYGON_RPC)
    _signer = new ethers.Wallet(PLATFORM_KEY, _provider)
    _contract = new ethers.Contract(CONTRACT_ADDRESS, farmcoinAbi as any, _signer)
  }
  return { ok: true, contract: _contract!, signer: _signer! }
}

// ── Retorna info do contrato ──────────────────────────────────
export async function getContractInfo() {
  const { ok, reason, contract } = getContracts() as any
  if (!ok) return { onchain: false, reason }

  try {
    const [name, symbol, decimals, totalSupply, treasuryBalance, fee] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
      contract.totalSupply(),
      contract.treasury().then((addr: string) => contract.balanceOf(addr)),
      contract.platformFeePercent(),
    ])

    return {
      onchain: true,
      contractAddress: CONTRACT_ADDRESS,
      network: 'Polygon',
      name, symbol,
      decimals: Number(decimals),
      totalSupply: Number(totalSupply) / 100,
      treasuryBalance: Number(treasuryBalance) / 100,
      platformFeePercent: Number(fee),
      polygonscanUrl: `https://polygonscan.com/token/${CONTRACT_ADDRESS}`,
    }
  } catch (err: any) {
    return { onchain: false, reason: err.message }
  }
}

// ── Mint on-chain ─────────────────────────────────────────────
export async function mintOnChain(params: {
  toAddress: string
  amount: number         // em FARMCOINS (ex: 100.00 = 10000 unidades no contrato)
  type: 'PRODUCTION' | 'ENERGY' | 'BONUS'
  ref: string
}): Promise<{ success: boolean; txHash?: string; error?: string; userTokens?: number; platformTokens?: number }> {
  const { ok, reason, contract } = getContracts() as any
  if (!ok) return { success: false, error: reason }

  try {
    // Converte para unidades do contrato (2 decimais)
    const amountInUnits = BigInt(Math.round(params.amount * 100))
    const mintTypeValue = MintType[params.type] ?? 0

    // Estima o gas
    const gasEstimate = await contract.mint.estimateGas(
      params.toAddress, amountInUnits, mintTypeValue, params.ref
    )

    // Executa mint (com 20% de margem no gas)
    const tx = await contract.mint(
      params.toAddress,
      amountInUnits,
      mintTypeValue,
      params.ref,
      { gasLimit: (gasEstimate * 120n) / 100n }
    )

    const receipt = await tx.wait(1) // aguarda 1 confirmação

    // Calcula split (30% plataforma, 70% usuário)
    const platformFee = Math.round(params.amount * 0.30 * 100) / 100
    const userTokens = Math.round((params.amount - platformFee) * 100) / 100

    return {
      success: true,
      txHash: receipt.hash,
      userTokens,
      platformTokens: platformFee,
    }
  } catch (err: any) {
    return { success: false, error: err.shortMessage ?? err.message }
  }
}

// ── Saldo on-chain de um endereço ────────────────────────────
export async function getOnchainBalance(address: string): Promise<number | null> {
  const { ok, contract } = getContracts() as any
  if (!ok) return null
  try {
    const balance = await contract.balanceOf(address)
    return Number(balance) / 100
  } catch {
    return null
  }
}

// ── Verifica se blockchain está disponível ───────────────────
export function isBlockchainEnabled() {
  return !!(PLATFORM_KEY && CONTRACT_ADDRESS)
}
