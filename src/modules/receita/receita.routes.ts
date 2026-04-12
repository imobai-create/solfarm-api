import { FastifyInstance } from 'fastify'
import { validarReceita } from './receita.service'

export async function receitaRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate)

  // POST /receita/validar — valida receita agronômica por imagem
  fastify.post('/validar', async (request, reply) => {
    try {
      const { imageBase64, mimeType } = request.body as {
        imageBase64: string
        mimeType?: string
      }

      if (!imageBase64) {
        return reply.status(400).send({ error: 'imageBase64 é obrigatório' })
      }

      const result = await validarReceita({
        imageBase64,
        mimeType: mimeType ?? 'image/jpeg',
      })

      return reply.send(result)
    } catch (err: any) {
      fastify.log.error(err)
      return reply.status(500).send({
        error: 'Erro ao analisar receita. Tente novamente.',
        detail: err?.message,
      })
    }
  })
}
