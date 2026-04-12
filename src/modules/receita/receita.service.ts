import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? '' })

// ── Produtos com alertas de uso indevido (base simplificada MAPA) ──
const PRODUTOS_RESTRICAO: Record<string, { alerta: string; classe: string }> = {
  'roundup': { alerta: 'Glifosato — uso restrito em algumas culturas. Respeitar carência.', classe: 'Herbicida' },
  'glifosato': { alerta: 'Verificar registro na cultura indicada. Período de carência mínimo 7 dias.', classe: 'Herbicida' },
  'paraquat': { alerta: 'BANIDO no Brasil desde 2020 (RDC ANVISA 177/2021). Uso ilegal.', classe: 'Herbicida' },
  'endossulfam': { alerta: 'BANIDO no Brasil. Uso ilegal.', classe: 'Inseticida' },
  'metamidofós': { alerta: 'BANIDO no Brasil. Uso ilegal.', classe: 'Inseticida' },
  'acefato': { alerta: 'Uso controlado. Verificar cultura registrada e EPI obrigatório.', classe: 'Inseticida' },
  'carbofurano': { alerta: 'Altamente tóxico (Classe I). Uso restrito, verificar registros.', classe: 'Inseticida' },
  'atrazina': { alerta: 'Proibido em áreas próximas a mananciais. Verificar AIA.', classe: 'Herbicida' },
}

function checarProdutosRestricao(texto: string): string[] {
  const alertas: string[] = []
  const textoLower = texto.toLowerCase()
  for (const [produto, info] of Object.entries(PRODUTOS_RESTRICAO)) {
    if (textoLower.includes(produto)) {
      alertas.push(`⚠️ ${produto.toUpperCase()} (${info.classe}): ${info.alerta}`)
    }
  }
  return alertas
}

// ── Análise da receita com Claude Vision ──────────────────────
async function analisarReceitaComClaude(imageBase64: string, mimeType: string) {
  const prompt = `Você é um engenheiro agrônomo especialista em defensivos agrícolas e legislação brasileira (MAPA, ANVISA, AGROFIT).

Analise esta receita agronômica e extraia as informações, depois valide cada item.

Retorne APENAS JSON puro (sem markdown) com este formato exato:
{
  "receita": {
    "numero": "número da receita ou null",
    "dataEmissao": "data ou null",
    "validade": "data de validade ou null",
    "agronomoResponsavel": "nome do responsável ou null",
    "crea": "número CREA/CRF ou null",
    "produtor": "nome do produtor ou null",
    "propriedade": "nome da propriedade ou null",
    "municipio": "município/estado ou null",
    "areaHa": "área em hectares ou null",
    "cultura": "cultura alvo (soja, milho, etc) ou null"
  },
  "produtos": [
    {
      "nome": "nome comercial",
      "principioAtivo": "ingrediente ativo",
      "dose": "dose por hectare",
      "unidade": "L/ha, kg/ha, g/ha, etc",
      "doseTotal": "dose total para área",
      "classeAgrotoxica": "Herbicida | Fungicida | Inseticida | Fertilizante | Outro",
      "classetoxicologica": "I (Extremamente tóxico) | II (Altamente tóxico) | III (Medianamente) | IV (Pouco tóxico) | Não identificada",
      "periodoCarencia": "em dias ou null",
      "epi": ["equipamentos de proteção mencionados"],
      "registradoParaCultura": true,
      "observacoes": "observações específicas sobre o produto"
    }
  ],
  "validacao": {
    "receitaValida": true,
    "problemas": ["lista de problemas encontrados"],
    "alertas": ["avisos importantes mas não bloqueantes"],
    "conformeLegislacao": true,
    "possuiCrea": true,
    "dentroValidade": true,
    "dosagensAdequadas": true,
    "recomendacoes": ["recomendações de segurança e boas práticas"]
  },
  "resumo": "resumo geral da receita em 2-3 frases",
  "confiancaLeitura": "Alta | Média | Baixa"
}`

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType as any, data: imageBase64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(clean)
}

// ── Serviço principal ─────────────────────────────────────────
export async function validarReceita(params: {
  imageBase64: string
  mimeType: string
}) {
  const { imageBase64, mimeType } = params

  const analise = await analisarReceitaComClaude(imageBase64, mimeType)

  // Checa produtos banidos/restritos na lista local
  const textoProdutos = analise.produtos?.map((p: any) =>
    `${p.nome} ${p.principioAtivo}`
  ).join(' ') ?? ''

  const alertasBanidos = checarProdutosRestricao(textoProdutos)
  if (alertasBanidos.length > 0) {
    analise.validacao.alertas = [
      ...(analise.validacao.alertas ?? []),
      ...alertasBanidos,
    ]
    if (alertasBanidos.some(a => a.includes('BANIDO'))) {
      analise.validacao.receitaValida = false
      analise.validacao.conformeLegislacao = false
      analise.validacao.problemas = [
        ...(analise.validacao.problemas ?? []),
        'Produto(s) banido(s) no Brasil identificado(s)',
      ]
    }
  }

  return {
    analise,
    metadados: {
      geradoEm: new Date().toISOString(),
      versao: '1.0',
      fontes: ['Claude Vision (Anthropic)', 'Base MAPA/ANVISA', 'AGROFIT'],
    },
  }
}
