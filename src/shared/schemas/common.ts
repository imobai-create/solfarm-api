import { z } from 'zod'

export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const uuidParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
})

export const brazilianStateSchema = z
  .string()
  .length(2, 'Use a sigla do estado (ex: MT)')
  .toUpperCase()
  .optional()

export const cpfCnpjSchema = z
  .string()
  .regex(/^(\d{11}|\d{14})$/, 'CPF deve ter 11 dígitos ou CNPJ 14 dígitos')
  .optional()

export const polygonAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Endereço Polygon inválido (0x + 40 hex)')

export type PaginationInput = z.infer<typeof paginationSchema>
