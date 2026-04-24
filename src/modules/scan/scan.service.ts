import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? '' })

// ── Bioma por estado brasileiro ───────────────────────────────
const BIOMA_POR_ESTADO: Record<string, string> = {
  AC: 'Amazônia', AM: 'Amazônia', RR: 'Amazônia', PA: 'Amazônia',
  AP: 'Amazônia', RO: 'Amazônia', MT: 'Amazônia / Cerrado / Pantanal',
  MA: 'Amazônia / Cerrado', TO: 'Cerrado / Amazônia',
  GO: 'Cerrado', DF: 'Cerrado', MS: 'Cerrado / Pantanal',
  MG: 'Cerrado / Mata Atlântica', SP: 'Cerrado / Mata Atlântica',
  PR: 'Mata Atlântica', SC: 'Mata Atlântica', RS: 'Mata Atlântica / Pampa',
  RJ: 'Mata Atlântica', ES: 'Mata Atlântica', BA: 'Mata Atlântica / Caatinga / Cerrado',
  SE: 'Mata Atlântica / Caatinga', AL: 'Caatinga / Mata Atlântica',
  PE: 'Caatinga / Mata Atlântica', PB: 'Caatinga', RN: 'Caatinga',
  CE: 'Caatinga', PI: 'Caatinga / Cerrado',
}

// ── Reverse geocode via Nominatim (OpenStreetMap — gratuito) ──
async function reverseGeocode(lat: number, lon: number) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt-BR`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SolFarm/1.0 (contato@solfarm.com.br)' },
    })
    if (!res.ok) return null
    const data: any = await res.json()
    return {
      municipio: data.address?.city ?? data.address?.town ?? data.address?.village ?? data.address?.county ?? 'Não identificado',
      estado: data.address?.state ?? '',
      estadoSigla: data.address?.['ISO3166-2-lvl4']?.replace('BR-', '') ?? '',
      pais: data.address?.country ?? 'Brasil',
      cep: data.address?.postcode ?? '',
      bairro: data.address?.suburb ?? data.address?.neighbourhood ?? '',
      enderecoCompleto: data.display_name ?? '',
    }
  } catch {
    return null
  }
}

// ── Dados hidrológicos da ANA (bacias hidrográficas) ─────────
async function getHydroData(lat: number, lon: number) {
  try {
    // ANA WFS — bacias hidrográficas nível 3
    const url = `https://geoserver.ana.gov.br/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=ana:BaciaHidrografica_Nivel3&outputFormat=application/json&CQL_FILTER=INTERSECTS(geom,POINT(${lon}%20${lat}))&count=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data: any = await res.json()
    if (data.features?.length > 0) {
      const props = data.features[0].properties
      return {
        bacia: props.nome ?? props.cobacia ?? 'Não identificada',
        area_km2: props.area_km2 ? Number(props.area_km2).toFixed(0) : null,
      }
    }
    return null
  } catch {
    return null
  }
}

// ── Alertas de desmatamento INPE/TerraBrasilis ────────────────
async function getDeforestationAlerts(lat: number, lon: number) {
  try {
    // Buffer de 50km ao redor do ponto
    const delta = 0.45
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`
    const url = `https://terrabrasilis.dpi.inpe.br/geoserver/deter-amz/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=deter-amz:deter_public&outputFormat=application/json&BBOX=${bbox}&maxFeatures=5`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { alertas: 0, risco: 'Baixo' }
    const data: any = await res.json()
    const count = data.features?.length ?? 0
    return {
      alertas: count,
      risco: count > 3 ? 'Alto' : count > 0 ? 'Médio' : 'Baixo',
    }
  } catch {
    return { alertas: 0, risco: 'Não verificado' }
  }
}

// ── Análise da imagem com Claude Vision ──────────────────────
async function analyzeImageWithClaude(imageBase64: string, mimeType: string, geo: any) {
  const locationContext = geo
    ? `Localização: ${geo.municipio}, ${geo.estadoSigla ?? geo.estado}, Brasil. Bioma provável: ${BIOMA_POR_ESTADO[geo.estadoSigla] ?? 'não identificado'}.`
    : 'Localização: Brasil (coordenadas não disponíveis).'

  const prompt = `Você é um especialista em agronomia, ecologia e sensoriamento remoto brasileiro. Analise esta foto de uma área rural/agrícola.

${locationContext}

Forneça uma análise estruturada em JSON com EXATAMENTE este formato (sem markdown, apenas JSON puro):
{
  "tipoUsoSolo": "ex: Lavoura de soja, Pastagem degradada, Mata nativa, Capoeira, etc.",
  "vegetacao": {
    "descricao": "descrição do que é visível",
    "estadoConservacao": "Preservado | Degradado | Alterado | Em recuperação",
    "presencaMataGaleria": true/false,
    "presencaCerradoNativo": true/false
  },
  "solo": {
    "aparencia": "Argiloso escuro | Arenoso claro | Rochoso | Encoberto por vegetação | etc.",
    "sinaisErosao": true/false,
    "sinaisCompactacao": true/false
  },
  "aguaSuperficie": {
    "presenca": true/false,
    "tipo": "Rio | Córrego | Represa | Veredas | Não visível"
  },
  "infraestrutura": {
    "estradas": true/false,
    "construcoes": true/false,
    "pivoCentral": true/false,
    "sistemaIrrigacao": true/false
  },
  "riscos": ["lista de riscos observados, ex: erosão laminar, voçoroca, pastagem degradada"],
  "potencialAgricola": "Alto | Médio | Baixo",
  "recomendacoes": ["até 3 recomendações práticas baseadas na imagem"],
  "confianca": "Alta | Média | Baixa",
  "observacoes": "observação geral sobre a área em 1-2 frases"
}`

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as any,
              data: imageBase64,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    throw new Error('Falha ao interpretar resposta da análise de imagem')
  }
}

// ── Serviço principal ─────────────────────────────────────────
export async function scanArea(params: {
  imageBase64: string
  mimeType: string
  latitude?: number
  longitude?: number
}) {
  const { imageBase64, mimeType, latitude, longitude } = params

  if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
    throw new Error('Latitude inválida (deve estar entre -90 e 90)')
  }
  if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
    throw new Error('Longitude inválida (deve estar entre -180 e 180)')
  }

  const hasCoords = latitude != null && longitude != null

  // Executa em paralelo o que puder
  const [geo, hydroData, deforestation] = await Promise.all([
    hasCoords ? reverseGeocode(latitude!, longitude!) : Promise.resolve(null),
    hasCoords ? getHydroData(latitude!, longitude!) : Promise.resolve(null),
    hasCoords ? getDeforestationAlerts(latitude!, longitude!) : Promise.resolve(null),
  ])

  // Análise Claude Vision (sequencial pois depende do geo para contexto)
  const analiseIA = await analyzeImageWithClaude(imageBase64, mimeType, geo)

  const estadoSigla = geo?.estadoSigla ?? ''
  const bioma = BIOMA_POR_ESTADO[estadoSigla] ?? 'Não identificado'

  return {
    localizacao: geo
      ? {
          municipio: geo.municipio,
          estado: geo.estado,
          estadoSigla,
          bioma,
          enderecoCompleto: geo.enderecoCompleto,
        }
      : null,
    coordenadas: hasCoords ? { latitude, longitude } : null,
    hidrologia: hydroData
      ? {
          bacia: hydroData.bacia,
          areaKm2: hydroData.area_km2,
        }
      : { bacia: 'Não identificada', areaKm2: null },
    desmatamento: deforestation ?? { alertas: 0, risco: 'Não verificado' },
    analiseImagem: analiseIA,
    metadados: {
      geradoEm: new Date().toISOString(),
      versao: '1.0',
      fontes: ['Claude Vision (Anthropic)', 'Nominatim/OSM', 'ANA', 'INPE TerraBrasilis'],
    },
  }
}
