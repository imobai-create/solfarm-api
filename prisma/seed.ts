import { PrismaClient, UserRole, UserPlan, CultureType, BiomeType, ProductCategory, PostCategory } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed do SolFarm...')

  // ========================
  // USUÁRIOS DE TESTE
  // ========================
  const hashedPassword = await bcrypt.hash('solfarm123', 10)

  const producer = await prisma.user.upsert({
    where: { email: 'joao@solfarm.com.br' },
    update: {},
    create: {
      name: 'João da Silva',
      email: 'joao@solfarm.com.br',
      phone: '65999887766',
      password: hashedPassword,
      cpfCnpj: '123.456.789-00',
      role: UserRole.PRODUCER,
      plan: UserPlan.CAMPO,
      isVerified: true,
      state: 'MT',
      city: 'Sorriso',
      region: 'Cerrado',
    },
  })

  const supplier = await prisma.user.upsert({
    where: { email: 'fornecedor@agrimax.com.br' },
    update: {},
    create: {
      name: 'AgriMax Insumos',
      email: 'fornecedor@agrimax.com.br',
      phone: '65988776655',
      password: hashedPassword,
      role: UserRole.SUPPLIER,
      plan: UserPlan.FAZENDA,
      isVerified: true,
      state: 'MT',
      city: 'Cuiabá',
    },
  })

  const admin = await prisma.user.upsert({
    where: { email: 'admin@solfarm.com.br' },
    update: {},
    create: {
      name: 'Admin SolFarm',
      email: 'admin@solfarm.com.br',
      password: hashedPassword,
      role: UserRole.ADMIN,
      plan: UserPlan.FAZENDA,
      isVerified: true,
    },
  })

  // ========================
  // ÁREA DE TESTE (Sorriso-MT, polígono real de exemplo)
  // ========================
  const areaPolygon = JSON.stringify({
    type: 'Polygon',
    coordinates: [[
      [-55.7200, -12.5500],
      [-55.6800, -12.5500],
      [-55.6800, -12.5800],
      [-55.7200, -12.5800],
      [-55.7200, -12.5500],
    ]],
  })

  const area = await prisma.area.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Fazenda Bom Futuro — Talhão 1',
      description: 'Talhão principal de soja, solo arenoso',
      hectares: 450.5,
      culture: CultureType.SOJA,
      soilType: 'Latossolo Vermelho-Amarelo',
      polygon: areaPolygon,
      centroidLat: -12.5650,
      centroidLng: -55.7000,
      bbox: JSON.stringify([-55.7200, -12.5800, -55.6800, -12.5500]),
      state: 'MT',
      city: 'Sorriso',
      biome: BiomeType.CERRADO,
      userId: producer.id,
    },
  })

  // ========================
  // PRODUTOS DO MARKETPLACE
  // ========================
  await prisma.product.createMany({
    skipDuplicates: true,
    data: [
      {
        name: 'Fertilizante NPK 10-10-10',
        description: 'Fertilizante granulado de alto desempenho para gramíneas e leguminosas. Formulação balanceada para cobertura.',
        category: ProductCategory.FERTILIZANTE,
        price: 189.90,
        unit: 'saco 50kg',
        stock: 500,
        brand: 'Mosaic',
        supplierId: supplier.id,
        state: 'MT',
        city: 'Cuiabá',
        isFeatured: true,
      },
      {
        name: 'Herbicida Roundup Original',
        description: 'Glifosato 480 g/L para controle de plantas daninhas em pós-emergência. Amplo espectro.',
        category: ProductCategory.DEFENSIVO,
        price: 89.50,
        unit: 'litro',
        stock: 200,
        brand: 'Bayer',
        supplierId: supplier.id,
        state: 'MT',
        city: 'Cuiabá',
        isFeatured: true,
      },
      {
        name: 'Semente de Soja M8349 IPRO',
        description: 'Variedade de alta produtividade com resistência à ferrugem asiática. Ciclo de 120 dias.',
        category: ProductCategory.SEMENTE,
        price: 420.00,
        unit: 'saco 40kg',
        stock: 150,
        brand: 'Monsoy',
        supplierId: supplier.id,
        state: 'MT',
        city: 'Cuiabá',
      },
      {
        name: 'Inoculante para Soja Nitrobacter',
        description: 'Inoculante líquido com bactérias fixadoras de nitrogênio. Reduz em até 70% o uso de ureia.',
        category: ProductCategory.INOCULANTE,
        price: 28.90,
        unit: 'dose/100kg semente',
        stock: 1000,
        brand: 'Total Biotecnologia',
        supplierId: supplier.id,
        state: 'MT',
        city: 'Cuiabá',
        isFeatured: true,
      },
      {
        name: 'Pulverizador Costal Elétrico 20L',
        description: 'Pulverizador elétrico com bateria 12V. Autonomia de 6h. Ideal para pequenas áreas.',
        category: ProductCategory.FERRAMENTA,
        price: 650.00,
        unit: 'unidade',
        stock: 30,
        brand: 'Guarany',
        supplierId: supplier.id,
        state: 'MT',
        city: 'Cuiabá',
      },
    ],
  })

  // ========================
  // POST NA COMUNIDADE
  // ========================
  await prisma.post.createMany({
    skipDuplicates: true,
    data: [
      {
        title: 'Alerta: Ferrugem asiática avançando no norte do MT',
        content: 'Pessoal, identificamos foco de ferrugem asiática nos talhões próximos a Sorriso. NDVI caiu 0.15 em 7 dias. Recomendo aplicação preventiva com triazol. Qualquer um viu sintomas na sua área?',
        category: PostCategory.ALERTA,
        state: 'MT',
        city: 'Sorriso',
        likes: 47,
        userId: producer.id,
      },
      {
        title: 'Resultado safra 23/24: 72 sacas/ha com inoculante',
        content: 'Usei inoculante pela primeira vez esse ano e cortei R$180/ha em ureia. Resultado foi 72 sacas/ha no talhão 1 (Latossolo). Alguém mais testou? Vale muito a pena o custo-benefício.',
        category: PostCategory.RESULTADO,
        state: 'MT',
        city: 'Sorriso',
        likes: 123,
        userId: producer.id,
      },
    ],
  })

  console.log('✅ Seed concluído com sucesso!')
  console.log(`   👤 Produtor: joao@solfarm.com.br | senha: solfarm123`)
  console.log(`   🏪 Fornecedor: fornecedor@agrimax.com.br | senha: solfarm123`)
  console.log(`   ⚙️  Admin: admin@solfarm.com.br | senha: solfarm123`)
  console.log(`   🌿 Área de teste: ${area.name} (${area.hectares} ha)`)
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
