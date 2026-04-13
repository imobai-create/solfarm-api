import type { FastifyInstance } from 'fastify'
import { Resend } from 'resend'
import { env } from '../../config/env'

export async function contactRoutes(fastify: FastifyInstance) {

  // ─── POST /contact ─── formulário de contato (sem autenticação)
  fastify.post('/', async (req, reply) => {
    const { nome, email, assunto, mensagem } = req.body as {
      nome: string
      email: string
      assunto: string
      mensagem: string
    }

    if (!nome || !email || !assunto || !mensagem) {
      return reply.status(400).send({ message: 'Todos os campos são obrigatórios' })
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ message: 'E-mail inválido' })
    }

    if (mensagem.length < 10) {
      return reply.status(400).send({ message: 'Mensagem muito curta' })
    }

    // Envia e-mail via Resend se chave disponível
    if (env.RESEND_API_KEY) {
      try {
        const resend = new Resend(env.RESEND_API_KEY)

        // E-mail para a equipe SolFarm
        await resend.emails.send({
          from: 'SolFarm <notificacoes@solfarm.com.br>',
          to: ['contato@solfarm.com.br'],
          replyTo: email,
          subject: `[Contato] ${assunto} — ${nome}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#16a34a;padding:24px;border-radius:8px 8px 0 0;">
                <h2 style="color:white;margin:0;">📨 Nova mensagem de contato</h2>
              </div>
              <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:120px;">Nome</td>
                      <td style="padding:8px 0;font-weight:600;">${nome}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">E-mail</td>
                      <td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Assunto</td>
                      <td style="padding:8px 0;">${assunto}</td></tr>
                </table>
                <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;" />
                <p style="color:#374151;line-height:1.6;white-space:pre-wrap;">${mensagem.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
              </div>
              <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px;">
                SolFarm · contato@solfarm.com.br · solfarm.com.br
              </p>
            </div>
          `,
        })

        // Confirmação automática para quem enviou
        await resend.emails.send({
          from: 'SolFarm <notificacoes@solfarm.com.br>',
          to: [email],
          subject: 'Recebemos sua mensagem — SolFarm',
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#16a34a;padding:24px;border-radius:8px 8px 0 0;">
                <h2 style="color:white;margin:0;">🌿 SolFarm</h2>
              </div>
              <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;">
                <p>Olá, <strong>${nome}</strong>!</p>
                <p>Recebemos sua mensagem sobre <strong>"${assunto}"</strong> e responderemos em até <strong>24 horas úteis</strong>.</p>
                <p style="color:#6b7280;">Enquanto isso, você pode acessar nossa plataforma em <a href="https://solfarm.com.br">solfarm.com.br</a>.</p>
              </div>
              <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px;">
                SolFarm Participações S/A · CNPJ 53.092.737/0001-48
              </p>
            </div>
          `,
        })
      } catch (err: any) {
        fastify.log.error('Erro ao enviar e-mail de contato:', err.message)
        // Não retorna erro para o usuário — mensagem registrada mas e-mail falhou
      }
    }

    return reply.status(200).send({ message: 'Mensagem enviada com sucesso!' })
  })
}
