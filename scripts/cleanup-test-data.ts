/**
 * Script de limpeza — apaga todos os dados de teste do marketplace e comunidade.
 * Uso: npx ts-node scripts/cleanup-test-data.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Iniciando limpeza de dados de teste...\n')

  // Marketplace — orders primeiro (FK), depois produtos
  const orderItems = await prisma.orderItem.deleteMany({})
  console.log(`✅ ${orderItems.count} itens de pedidos removidos`)

  const orders = await prisma.order.deleteMany({})
  console.log(`✅ ${orders.count} pedidos removidos`)

  const products = await prisma.product.deleteMany({})
  console.log(`✅ ${products.count} produtos do marketplace removidos`)

  // Comunidade — posts
  const posts = await prisma.post.deleteMany({})
  console.log(`✅ ${posts.count} posts da comunidade removidos`)

  console.log('\n🎉 Limpeza concluída!')
}

main()
  .catch(e => { console.error('❌ Erro:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
