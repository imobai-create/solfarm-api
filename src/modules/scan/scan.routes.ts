import { FastifyInstance } from 'fastify'
import { scanArea } from './scan.service'

export async function scanRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate)

  // POST /scan — recebe imagem base64 + coordenadas
  fastify.post('/', async (request, reply) => {
    try {
      const { imageBase64, mimeType, latitude, longitude } = request.body as {
        imageBase64: string
        mimeType?: string
        latitude?: number
        longitude?: number
      }

      if (!imageBase64) {
        return reply.status(400).send({ error: 'imageBase64 é obrigatório' })
      }

      const result = await scanArea({
        imageBase64,
        mimeType: mimeType ?? 'image/jpeg',
        latitude,
        longitude,
      })

      return reply.send({ scan: result })
    } catch (err: any) {
      fastify.log.error(err)
      return reply.status(500).send({
        error: 'Erro ao processar imagem. Tente novamente.',
        detail: err?.message,
      })
    }
  })
}
