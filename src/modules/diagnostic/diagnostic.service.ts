import { prisma } from '../../config/database'
import { SatelliteService } from '../satellite/satellite.service'
import { NotFoundError, ForbiddenError, AppError } from '../../shared/errors/AppError'
import type { HealthStatus, CultureType, BiomeType } from '@prisma/client'

interface DiagnosticProblem {
  type: string
  severity: 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO'
  description: string
  zone?: string
  affectedArea?: number // % da área afetada
}

interface DiagnosticRecommendation {
  category: 'FERTILIZANTE' | 'DEFENSIVO' | 'IRRIGACAO' | 'CULTURA' | 'MANEJO' | 'INSUMO'
  priority: 'URGENTE' | 'ALTA' | 'MEDIA' | 'BAIXA'
  action: string
  detail?: string
  estimatedCostReduction?: number // % de redução de custo
  estimatedProductivityGain?: number // % de ganho de produtividade
  productKeywords?: string[] // palavras-chave para busca no marketplace
}

interface FertilizationZone {
  zone: string
  ndvi: number
  status: string
  nitrogenDose: number    // kg N/ha recomendado
  phosphorusDose: number  // kg P2O5/ha recomendado
  potassiumDose: number   // kg K2O/ha recomendado
  limeDose?: number       // ton/ha calcário
  priority: 'URGENTE' | 'NORMAL' | 'BAIXA'
}

// ──────────────────────────────────────────────
// Tabelas de referência agronômica (simplificadas)
// Fonte: Embrapa, IAC, CREA-MT guidelines
// ──────────────────────────────────────────────

const CULTURE_NITROGEN_BASE: Record<string, number> = {
  SOJA: 0,         // Soja fixa N via simbiose
  MILHO: 120,
  CAFE: 100,
  CANA: 80,
  ALGODAO: 90,
  ARROZ: 60,
  FEIJAO: 20,
  TRIGO: 80,
  MANDIOCA: 30,
  PASTAGEM: 50,
  DEFAULT: 60,
}

const CULTURE_YIELD_POTENTIAL: Record<string, { value: number; unit: string }> = {
  SOJA: { value: 65, unit: 'sacas/ha' },
  MILHO: { value: 180, unit: 'sacas/ha' },
  CAFE: { value: 45, unit: 'sacas/ha' },
  CANA: { value: 90, unit: 'ton/ha' },
  ALGODAO: { value: 250, unit: '@/ha' },
  ARROZ: { value: 150, unit: 'sacas/ha' },
  FEIJAO: { value: 30, unit: 'sacas/ha' },
  TRIGO: { value: 50, unit: 'sacas/ha' },
  DEFAULT: { value: 0, unit: 'ton/ha' },
}

const BIOME_CULTURE_FIT: Record<string, string[]> = {
  CERRADO: ['SOJA', 'MILHO', 'ALGODAO', 'CAFE', 'CANA', 'FEIJAO'],
  AMAZONIA: ['SOJA', 'MILHO', 'MANDIOCA', 'CAFE', 'FRUTAS'],
  MATA_ATLANTICA: ['CAFE', 'HORTIFRUTI', 'FRUTAS', 'FEIJAO', 'MILHO'],
  CAATINGA: ['FEIJAO', 'MILHO', 'MANDIOCA', 'FRUTAS', 'ALGODAO'],
  PAMPA: ['SOJA', 'MILHO', 'TRIGO', 'ARROZ', 'PASTAGEM'],
  PANTANAL: ['PASTAGEM', 'ARROZ', 'SOJA', 'MILHO'],
}

export class DiagnosticService {
  private satelliteService = new SatelliteService()

  // ──────────────────────────────────────────────
  // GERA DIAGNÓSTICO COMPLETO DA ÁREA
  // ──────────────────────────────────────────────
  async generate(areaId: string, userId: string, satelliteImageId?: string) {
    const area = await prisma.area.findUnique({
      where: { id: areaId },
      include: {
        satelliteImages: {
          where: { status: 'READY' },
          orderBy: { acquisitionDate: 'desc' },
          take: 1,
        },
      },
    })

    if (!area) throw new NotFoundError('Área')
    if (area.userId !== userId) throw new ForbiddenError()

    // Usa imagem específica ou a mais recente
    const imageId = satelliteImageId ?? area.satelliteImages[0]?.id

    if (!imageId) {
      throw new AppError(
        'Nenhuma imagem de satélite disponível. Processe uma imagem primeiro.',
        400,
        'NO_SATELLITE_IMAGE'
      )
    }

    const image = await prisma.satelliteImage.findUnique({ where: { id: imageId } })
    if (!image) throw new NotFoundError('Imagem de satélite')

    // ── Análise dos índices ──
    const ndvi = image.ndviMean ?? 0
    const ndre = image.ndreMean ?? null
    const ndwi = image.ndwiMean ?? null
    const zones = image.zonesMap ? JSON.parse(image.zonesMap) : []

    // ── Score geral (0-10) ──
    const score = this.calculateScore(ndvi, ndre, ndwi, image.cloudCover)

    // ── Status de saúde ──
    const healthStatus = this.satelliteService.ndviToHealthStatus(ndvi) as HealthStatus

    // ── Identifica problemas ──
    const problems = this.identifyProblems(ndvi, ndre, ndwi, zones, area.culture as string)

    // ── Gera recomendações ──
    const recommendations = this.generateRecommendations(
      problems,
      ndvi,
      ndre,
      ndwi,
      area.culture as string,
      area.biome as string
    )

    // ── Culturas recomendadas ──
    const recommendedCultures = this.recommendCultures(
      area.biome as string,
      area.culture as string,
      ndvi,
      ndwi
    )

    // ── Plano de fertilização por zona (VRA) ──
    const fertilizationPlan = this.generateFertilizationPlan(zones, area.culture as string, ndre)

    // ── Estimativa de produtividade ──
    const yieldEstimate = this.estimateYield(ndvi, area.culture as string, area.hectares)

    // Salva o diagnóstico
    const diagnostic = await prisma.diagnostic.create({
      data: {
        areaId,
        userId,
        satelliteImageId: imageId,
        score,
        healthStatus,
        problems: JSON.stringify(problems),
        recommendations: JSON.stringify(recommendations),
        recommendedCultures: JSON.stringify(recommendedCultures),
        fertilizationPlan: JSON.stringify(fertilizationPlan),
        yieldEstimate: yieldEstimate.value,
        yieldUnit: yieldEstimate.unit,
      },
    })

    return {
      id: diagnostic.id,
      createdAt: diagnostic.createdAt,
      area: {
        id: area.id,
        name: area.name,
        hectares: area.hectares,
        culture: area.culture,
        biome: area.biome,
      },
      satellite: {
        acquisitionDate: image.acquisitionDate,
        cloudCover: image.cloudCover,
        satellite: image.satellite,
        indices: {
          ndvi: { mean: ndvi, min: image.ndviMin, max: image.ndviMax },
          ndre: ndre ? { mean: ndre } : null,
          ndwi: ndwi ? { mean: ndwi } : null,
          evi: image.eviMean ? { mean: image.eviMean } : null,
        },
        zonesMap: zones,
      },
      score,
      healthStatus,
      healthLabel: this.healthLabel(healthStatus),
      problems,
      recommendations,
      recommendedCultures,
      fertilizationPlan,
      yieldEstimate,
      summary: this.generateSummary(score, healthStatus, problems, area.culture as string),
    }
  }

  // ──────────────────────────────────────────────
  // Lista todos os diagnósticos do usuário
  // ──────────────────────────────────────────────
  async listAll(userId: string) {
    const diagnostics = await prisma.diagnostic.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        area: {
          select: { name: true, hectares: true, culture: true, biome: true, state: true, city: true },
        },
        satelliteImage: {
          select: { acquisitionDate: true, ndviMean: true, ndreMean: true, ndwiMean: true, cloudCover: true, thumbnailUrl: true },
        },
      },
    })

    return diagnostics.map(d => ({
      ...d,
      problems: JSON.parse(d.problems),
      recommendations: JSON.parse(d.recommendations),
      recommendedCultures: d.recommendedCultures ? JSON.parse(d.recommendedCultures) : [],
      fertilizationPlan: d.fertilizationPlan ? JSON.parse(d.fertilizationPlan) : [],
    }))
  }

  // ──────────────────────────────────────────────
  // Lista diagnósticos de uma área
  // ──────────────────────────────────────────────
  async list(areaId: string, userId: string) {
    const area = await prisma.area.findUnique({ where: { id: areaId } })
    if (!area) throw new NotFoundError('Área')
    if (area.userId !== userId) throw new ForbiddenError()

    const diagnostics = await prisma.diagnostic.findMany({
      where: { areaId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        satelliteImage: {
          select: { acquisitionDate: true, ndviMean: true, cloudCover: true, thumbnailUrl: true },
        },
      },
    })

    return diagnostics.map(d => ({
      ...d,
      problems: JSON.parse(d.problems),
      recommendations: JSON.parse(d.recommendations),
      recommendedCultures: d.recommendedCultures ? JSON.parse(d.recommendedCultures) : [],
      fertilizationPlan: d.fertilizationPlan ? JSON.parse(d.fertilizationPlan) : [],
    }))
  }

  // ──────────────────────────────────────────────
  // Detalhe de um diagnóstico
  // ──────────────────────────────────────────────
  async findOne(diagnosticId: string, userId: string) {
    const diagnostic = await prisma.diagnostic.findUnique({
      where: { id: diagnosticId },
      include: {
        area: { select: { name: true, hectares: true, culture: true, biome: true, state: true, city: true } },
        satelliteImage: true,
      },
    })

    if (!diagnostic) throw new NotFoundError('Diagnóstico')
    if (diagnostic.userId !== userId) throw new ForbiddenError()

    return {
      ...diagnostic,
      problems: JSON.parse(diagnostic.problems),
      recommendations: JSON.parse(diagnostic.recommendations),
      recommendedCultures: diagnostic.recommendedCultures
        ? JSON.parse(diagnostic.recommendedCultures)
        : [],
      fertilizationPlan: diagnostic.fertilizationPlan
        ? JSON.parse(diagnostic.fertilizationPlan)
        : [],
      satelliteImage: diagnostic.satelliteImage
        ? {
            ...diagnostic.satelliteImage,
            zonesMap: diagnostic.satelliteImage.zonesMap
              ? JSON.parse(diagnostic.satelliteImage.zonesMap)
              : null,
          }
        : null,
    }
  }

  // ──────────────────────────────────────────────
  // MOTOR DE ANÁLISE — Cálculo do Score
  // ──────────────────────────────────────────────
  private calculateScore(ndvi: number, ndre: number | null, ndwi: number | null, cloudCover: number): number {
    let score = 0

    // NDVI tem peso 60% no score (saúde da vegetação)
    if (ndvi > 0.7) score += 6.0
    else if (ndvi > 0.5) score += 4.5 + ((ndvi - 0.5) / 0.2) * 1.5
    else if (ndvi > 0.3) score += 2.5 + ((ndvi - 0.3) / 0.2) * 2.0
    else if (ndvi > 0.1) score += 0.5 + ((ndvi - 0.1) / 0.2) * 2.0
    else score += 0.5

    // NDRE tem peso 25% (status de nitrogênio)
    if (ndre !== null) {
      if (ndre > 0.3) score += 2.5
      else if (ndre > 0.15) score += 1.5 + ((ndre - 0.15) / 0.15) * 1.0
      else score += ndre / 0.15 * 1.5
    } else {
      score += 1.25 // sem dado = neutro
    }

    // NDWI tem peso 15% (estresse hídrico)
    if (ndwi !== null) {
      if (ndwi > 0.1) score += 1.5  // umidade adequada
      else if (ndwi > -0.1) score += 1.0
      else score += 0.3               // estresse hídrico
    } else {
      score += 0.75
    }

    // Penalidade por alta cobertura de nuvens (qualidade da imagem)
    if (cloudCover > 15) score *= 0.95

    return Math.min(10, Math.max(0, Math.round(score * 10) / 10))
  }

  // ──────────────────────────────────────────────
  // MOTOR DE ANÁLISE — Identifica Problemas
  // ──────────────────────────────────────────────
  private identifyProblems(
    ndvi: number,
    ndre: number | null,
    ndwi: number | null,
    zones: any[],
    culture: string
  ): DiagnosticProblem[] {
    const problems: DiagnosticProblem[] = []

    // ── Estresse hídrico (NDWI) ──
    if (ndwi !== null && ndwi < -0.2) {
      problems.push({
        type: 'ESTRESSE_HIDRICO',
        severity: ndwi < -0.4 ? 'CRITICO' : 'ALTO',
        description: `NDWI de ${ndwi.toFixed(3)} indica déficit hídrico significativo na área. ${ndwi < -0.4 ? 'Risco severo de perda de produção.' : 'Atenção ao sistema de irrigação ou aguardar chuvas.'}`,
        affectedArea: this.estimateAffectedArea(zones, (z: any) => z.ndwi < -0.2),
      })
    }

    // ── Deficiência de nitrogênio (NDRE) ──
    if (ndre !== null && ndre < 0.1 && culture !== 'SOJA') {
      problems.push({
        type: 'DEFICIENCIA_NITROGENIO',
        severity: ndre < 0.05 ? 'ALTO' : 'MEDIO',
        description: `NDRE de ${ndre.toFixed(3)} indica deficiência de nitrogênio. Folhas podem estar amarelando (clorose). Recomenda-se análise foliar para confirmação.`,
        affectedArea: 65,
      })
    }

    // ── Vegetação degradada por zona (NDVI por zona) ──
    const criticalZones = zones.filter((z: any) => z.ndvi < 0.2 && z.status !== 'VAZIO')
    if (criticalZones.length > 0) {
      problems.push({
        type: 'ZONA_CRITICA_VEGETACAO',
        severity: criticalZones.length > 3 ? 'ALTO' : 'MEDIO',
        description: `${criticalZones.length} zona(s) com NDVI crítico (< 0.2): ${criticalZones.map((z: any) => z.zone).join(', ')}. Possível falha no stand, praga ou doença localizada.`,
        zone: criticalZones.map((z: any) => z.zone).join(', '),
        affectedArea: (criticalZones.length / zones.length) * 100,
      })
    }

    // ── NDVI muito baixo (saúde geral da vegetação) ──
    if (ndvi < 0.25) {
      problems.push({
        type: 'VEGETACAO_DEBIL',
        severity: ndvi < 0.1 ? 'CRITICO' : 'ALTO',
        description: `NDVI médio de ${ndvi.toFixed(3)} indica vegetação muito debilitada. ${ndvi < 0.1 ? 'Área pode estar com solo exposto, queimada ou cultura em colapso.' : 'Intervenção urgente necessária.'}`,
        affectedArea: 100,
      })
    } else if (ndvi < 0.4) {
      problems.push({
        type: 'VEGETACAO_ABAIXO_POTENCIAL',
        severity: 'MEDIO',
        description: `NDVI de ${ndvi.toFixed(3)} indica que a vegetação está abaixo do potencial para a cultura ${culture ?? 'atual'}. Verifique adubação, pragas e doenças.`,
        affectedArea: 70,
      })
    }

    // ── Variabilidade interna alta (zonas muito diferentes) ──
    if (zones.length > 0) {
      const ndviValues = zones.map((z: any) => z.ndvi)
      const ndviRange = Math.max(...ndviValues) - Math.min(...ndviValues)
      if (ndviRange > 0.3) {
        problems.push({
          type: 'ALTA_VARIABILIDADE_INTERNA',
          severity: ndviRange > 0.5 ? 'ALTO' : 'MEDIO',
          description: `Variação de NDVI de ${ndviRange.toFixed(2)} entre zonas indica heterogeneidade no talhão. Possíveis causas: variação de solo, compactação, fertilidade desuniforme. Recomenda-se manejo por zona (VRA).`,
          affectedArea: 40,
        })
      }
    }

    return problems
  }

  // ──────────────────────────────────────────────
  // MOTOR DE ANÁLISE — Gera Recomendações
  // ──────────────────────────────────────────────
  private generateRecommendations(
    problems: DiagnosticProblem[],
    ndvi: number,
    ndre: number | null,
    ndwi: number | null,
    culture: string,
    biome: string
  ): DiagnosticRecommendation[] {
    const recs: DiagnosticRecommendation[] = []
    const problemTypes = problems.map(p => p.type)

    // Recomendações baseadas nos problemas detectados

    if (problemTypes.includes('ESTRESSE_HIDRICO')) {
      recs.push({
        category: 'IRRIGACAO',
        priority: 'URGENTE',
        action: 'Verificar e ativar sistema de irrigação ou aguardar precipitação',
        detail: 'O índice NDWI indica déficit hídrico. Em lavouras sem irrigação, monitorar previsão de chuvas. Com irrigação, verificar lâmina de aplicação e uniformidade dos aspersores/pivôs.',
        estimatedProductivityGain: 25,
        productKeywords: ['pivô central', 'gotejamento', 'irrigação', 'tensiômetro'],
      })
    }

    if (problemTypes.includes('DEFICIENCIA_NITROGENIO')) {
      const nitrogenBase = CULTURE_NITROGEN_BASE[culture] ?? CULTURE_NITROGEN_BASE.DEFAULT
      recs.push({
        category: 'FERTILIZANTE',
        priority: 'ALTA',
        action: `Aplicar ${Math.round(nitrogenBase * 0.4)}-${Math.round(nitrogenBase * 0.6)} kg N/ha em cobertura`,
        detail: 'Deficiência de nitrogênio confirmada pelo índice NDRE. Recomenda-se ureia (45% N) ou nitrato de amônio. Aplicar com umidade no solo. Considerar análise foliar para dosagem precisa.',
        estimatedCostReduction: 0,
        estimatedProductivityGain: 15,
        productKeywords: ['ureia', 'nitrogênio', 'adubação cobertura', 'sulfato amônio'],
      })
    }

    if (problemTypes.includes('ZONA_CRITICA_VEGETACAO')) {
      recs.push({
        category: 'MANEJO',
        priority: 'ALTA',
        action: 'Vistoriar zonas críticas presencialmente para identificar causa',
        detail: 'Zonas com NDVI crítico precisam de diagnóstico presencial. Causas possíveis: falha na germinação, ataque de pragas de solo (lagarta-do-cartucho, percevejo barriga-verde), compactação, excesso de umidade localizado.',
        productKeywords: ['inseticida solo', 'defensivo', 'análise solo'],
      })
    }

    if (problemTypes.includes('ALTA_VARIABILIDADE_INTERNA')) {
      recs.push({
        category: 'FERTILIZANTE',
        priority: 'MEDIA',
        action: 'Adotar Aplicação em Taxa Variável (VRA) baseada no mapa de zonas',
        detail: 'A alta variabilidade interna justifica manejo diferenciado por zona. O plano de fertilização por zona abaixo calcula a dose recomendada para cada subdivisão do talhão, podendo reduzir até 25% o uso de insumos.',
        estimatedCostReduction: 20,
        estimatedProductivityGain: 10,
        productKeywords: ['fertilizante granulado', 'NPK', 'aplicação variável'],
      })
    }

    // Recomendações baseadas no NDVI geral (independente de problemas)
    if (ndvi > 0.5) {
      recs.push({
        category: 'MANEJO',
        priority: 'BAIXA',
        action: 'Manter manejo atual — vegetação em bom estado',
        detail: 'NDVI acima de 0.5 indica vegetação saudável. Continue monitorando a cada 7-14 dias para detectar variações precocemente.',
        estimatedProductivityGain: 0,
      })
    }

    // Recomendação de inoculante para soja
    if (culture === 'SOJA') {
      recs.push({
        category: 'INSUMO',
        priority: 'MEDIA',
        action: 'Usar inoculante com Bradyrhizobium na próxima semeadura',
        detail: 'Inoculação com bactérias fixadoras de N2 pode substituir totalmente a adubação nitrogenada na soja, reduzindo custos em R$150-200/ha. Compatível com tratamento de sementes.',
        estimatedCostReduction: 30,
        estimatedProductivityGain: 5,
        productKeywords: ['inoculante soja', 'bradyrhizobium', 'fixação nitrogênio'],
      })
    }

    return recs
  }

  // ──────────────────────────────────────────────
  // Recomenda culturas para próxima safra
  // ──────────────────────────────────────────────
  private recommendCultures(
    biome: string,
    currentCulture: string,
    ndvi: number,
    ndwi: number | null
  ): { culture: string; score: number; reason: string }[] {
    const biomeOptions = BIOME_CULTURE_FIT[biome] ?? BIOME_CULTURE_FIT.CERRADO
    const isWaterStressed = ndwi !== null && ndwi < -0.2

    return biomeOptions
      .filter(c => c !== currentCulture) // sugere rotação
      .slice(0, 4)
      .map(culture => {
        let score = 70
        let reason = `Adequada para o bioma ${biome}`

        if (isWaterStressed && ['FEIJAO', 'MANDIOCA'].includes(culture)) {
          score += 15
          reason += '. Mais tolerante ao déficit hídrico'
        }

        if (!isWaterStressed && ['SOJA', 'MILHO'].includes(culture)) {
          score += 10
          reason += '. Alta rentabilidade na região'
        }

        if (culture !== currentCulture) {
          score += 5
          reason += '. Rotação de culturas melhora a saúde do solo'
        }

        return { culture, score: Math.min(100, score), reason }
      })
      .sort((a, b) => b.score - a.score)
  }

  // ──────────────────────────────────────────────
  // Plano de Fertilização por Zona (VRA)
  // ──────────────────────────────────────────────
  private generateFertilizationPlan(
    zones: any[],
    culture: string,
    ndre: number | null
  ): FertilizationZone[] {
    const nBase = CULTURE_NITROGEN_BASE[culture] ?? CULTURE_NITROGEN_BASE.DEFAULT

    return zones.map(zone => {
      const ndvi = zone.ndvi
      // Quanto mais baixo o NDVI, maior a dose de fertilizante necessária
      const deficitFactor = Math.max(0, 1 - ndvi / 0.7) // 0 = perfeito, 1 = crítico

      // Doses ajustadas pela deficiência
      const nitrogenDose = culture === 'SOJA'
        ? 0  // Soja não precisa de N (fixação biológica)
        : Math.round(nBase * (0.5 + deficitFactor * 0.8))

      const phosphorusDose = Math.round(40 + deficitFactor * 30)
      const potassiumDose = Math.round(60 + deficitFactor * 40)

      // Calcário se NDRE muito baixo (acidez)
      const limeDose = (ndre !== null && ndre < 0.05) ? 1.5 : undefined

      return {
        zone: zone.zone,
        ndvi: zone.ndvi,
        status: zone.status,
        nitrogenDose,
        phosphorusDose,
        potassiumDose,
        limeDose,
        priority: deficitFactor > 0.6 ? 'URGENTE' : deficitFactor > 0.3 ? 'NORMAL' : 'BAIXA',
      }
    })
  }

  // ──────────────────────────────────────────────
  // Estimativa de produtividade
  // ──────────────────────────────────────────────
  private estimateYield(ndvi: number, culture: string, hectares: number) {
    const potential = CULTURE_YIELD_POTENTIAL[culture] ?? CULTURE_YIELD_POTENTIAL.DEFAULT
    if (potential.value === 0) return { value: 0, unit: 'ton/ha', totalEstimate: 0 }

    // Modelo simplificado: produtividade ∝ NDVI (correlação empírica)
    const ndviFactor = ndvi > 0.7 ? 1.0 : ndvi > 0.5 ? 0.85 : ndvi > 0.3 ? 0.65 : 0.40
    const estimated = Math.round(potential.value * ndviFactor)
    const total = Math.round(estimated * hectares)

    return {
      value: estimated,
      unit: potential.unit,
      totalEstimate: total,
      totalUnit: potential.unit.replace('/ha', '').trim(),
      efficiency: Math.round(ndviFactor * 100),
    }
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────
  private estimateAffectedArea(zones: any[], predicate: (z: any) => boolean): number {
    if (zones.length === 0) return 50
    const affected = zones.filter(predicate).length
    return Math.round((affected / zones.length) * 100)
  }

  private healthLabel(status: string): string {
    const labels: Record<string, string> = {
      EXCELENTE: '🟢 Excelente',
      BOM: '🟡 Bom',
      REGULAR: '🟠 Regular',
      CRITICO: '🔴 Crítico',
      MUITO_RUIM: '⚫ Muito Ruim',
    }
    return labels[status] ?? status
  }

  private generateSummary(
    score: number,
    healthStatus: string,
    problems: DiagnosticProblem[],
    culture: string
  ): string {
    const criticalProblems = problems.filter(p => p.severity === 'CRITICO').length
    const highProblems = problems.filter(p => p.severity === 'ALTO').length

    if (score >= 8) {
      return `Sua área está em excelente condição com score ${score}/10. A vegetação de ${culture ?? 'cultura atual'} apresenta vigor adequado. Continue monitorando regularmente.`
    }

    if (score >= 6) {
      return `Score ${score}/10 — Área em condição boa, mas com ${problems.length} ponto(s) de atenção. Siga as recomendações para otimizar a produtividade.`
    }

    if (criticalProblems > 0) {
      return `⚠️ Score ${score}/10 — ${criticalProblems} problema(s) CRÍTICO(S) detectado(s). Intervenção urgente necessária para evitar perdas significativas na produção.`
    }

    return `Score ${score}/10 — ${problems.length} problema(s) identificado(s) na área. Siga o plano de fertilização e as recomendações abaixo para recuperar a produtividade.`
  }
}
