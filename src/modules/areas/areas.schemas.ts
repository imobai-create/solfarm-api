import { z } from 'zod'

// Validação de polígono GeoJSON
const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),  // longitude
  z.number().min(-90).max(90),    // latitude
])

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(
    z.array(coordinateSchema).min(4, 'Polígono precisa de pelo menos 4 pontos')
  ).min(1),
})

export const createAreaSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  culture: z.enum([
    'SOJA', 'MILHO', 'CAFE', 'CANA', 'ALGODAO', 'ARROZ',
    'FEIJAO', 'TRIGO', 'MANDIOCA', 'EUCALIPTO', 'PASTAGEM',
    'HORTIFRUTI', 'FRUTAS', 'OUTRO', 'VAZIO',
  ]).optional(),
  soilType: z.string().max(100).optional(),
  polygon: polygonSchema,
  state: z.string().length(2).optional(),
  city: z.string().max(100).optional(),
  biome: z.enum([
    'CERRADO', 'AMAZONIA', 'MATA_ATLANTICA', 'CAATINGA', 'PAMPA', 'PANTANAL',
  ]).optional(),
})

export const updateAreaSchema = createAreaSchema.partial().omit({ polygon: true })

export const listAreasQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(10),
  culture: z.string().optional(),
  state: z.string().optional(),
  biome: z.string().optional(),
})

export type CreateAreaInput = z.infer<typeof createAreaSchema>
export type UpdateAreaInput = z.infer<typeof updateAreaSchema>
export type ListAreasQuery = z.infer<typeof listAreasQuerySchema>
