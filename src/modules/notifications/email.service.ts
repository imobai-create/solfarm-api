import { Resend } from 'resend'
import { env } from '../../config/env'

// Instancia apenas quando a chave estiver disponível (lazy)
function getResend() {
  if (!env.RESEND_API_KEY) return null
  return new Resend(env.RESEND_API_KEY)
}

const FROM = 'SolFarm <notificacoes@solfarm.com.br>'

// ── Email: diagnóstico pronto ─────────────────────────────────
export async function sendDiagnosticReady(params: {
  toEmail: string
  toName: string
  areaName: string
  diagnosticId: string
  healthStatus: string
  score: number
  ndvi?: number
}) {
  const resend = getResend()
  if (!resend) return

  const { toEmail, toName, areaName, diagnosticId, healthStatus, score, ndvi } = params

  const statusEmoji: Record<string, string> = {
    SAUDAVEL: '🟢', ATENCAO: '🟡', CRITICO: '🔴', DESCONHECIDO: '⚪',
  }
  const emoji = statusEmoji[healthStatus] ?? '🌿'

  const healthLabel: Record<string, string> = {
    SAUDAVEL: 'Saudável', ATENCAO: 'Atenção necessária',
    CRITICO: 'Estado crítico', DESCONHECIDO: 'Não determinado',
  }

  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `${emoji} Diagnóstico pronto — ${areaName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ece4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#14532d,#16a34a);border-radius:16px;padding:32px;text-align:center;margin-bottom:20px">
      <img src="https://solfarm.com.br/logo.png" alt="SolFarm" style="height:40px;margin-bottom:16px" onerror="this.style.display='none'">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800">Diagnóstico Concluído</h1>
      <p style="color:rgba(255,255,255,0.8);margin:8px 0 0">Seu relatório agronômico está pronto</p>
    </div>

    <!-- Card principal -->
    <div style="background:#fff;border-radius:16px;padding:28px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
      <p style="color:#44403c;font-size:16px;margin:0 0 20px">Olá, <strong>${toName.split(' ')[0]}</strong>! 👋</p>

      <div style="background:#f8f7f4;border-radius:12px;padding:20px;margin-bottom:20px">
        <h2 style="margin:0 0 4px;font-size:18px;color:#1c1917">${areaName}</h2>
        <p style="margin:0;color:#78716c;font-size:14px">Análise via satélite concluída</p>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:20px">
        <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:800;color:#16a34a">${score}</div>
          <div style="font-size:12px;color:#4ade80;font-weight:600;margin-top:4px">Score de saúde</div>
        </div>
        <div style="flex:1;background:#f8f7f4;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:24px">${emoji}</div>
          <div style="font-size:12px;color:#78716c;font-weight:600;margin-top:4px">${healthLabel[healthStatus] ?? healthStatus}</div>
        </div>
        ${ndvi != null ? `
        <div style="flex:1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#2563eb">${ndvi.toFixed(2)}</div>
          <div style="font-size:12px;color:#60a5fa;font-weight:600;margin-top:4px">NDVI</div>
        </div>` : ''}
      </div>

      <a href="https://solfarm.com.br/dashboard/diagnostics/${diagnosticId}"
         style="display:block;background:#16a34a;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-weight:700;font-size:16px">
        Ver relatório completo →
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px">
      <p style="color:#a8a29e;font-size:12px;margin:0">
        SolFarm · Agro Inteligente para o Produtor Brasileiro<br>
        <a href="https://solfarm.com.br" style="color:#16a34a">solfarm.com.br</a>
      </p>
    </div>
  </div>
</body>
</html>`,
  })
}

// ── Email: boas-vindas ────────────────────────────────────────
export async function sendWelcome(params: { toEmail: string; toName: string }) {
  const resend = getResend()
  if (!resend) return

  await resend.emails.send({
    from: FROM,
    to: params.toEmail,
    subject: '🌿 Bem-vindo ao SolFarm!',
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f0ece4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#14532d,#16a34a);border-radius:16px;padding:32px;text-align:center;margin-bottom:20px">
      <div style="font-size:48px">🌿</div>
      <h1 style="color:#fff;margin:12px 0 0;font-size:26px;font-weight:800">Bem-vindo ao SolFarm!</h1>
      <p style="color:rgba(255,255,255,0.8);margin:8px 0 0">Tecnologia de satélite para sua lavoura</p>
    </div>

    <div style="background:#fff;border-radius:16px;padding:28px;margin-bottom:16px">
      <p style="color:#44403c;font-size:16px">Olá, <strong>${params.toName.split(' ')[0]}</strong>! 👋</p>
      <p style="color:#78716c;line-height:1.6">Sua conta foi criada com sucesso. Agora você tem acesso a:</p>

      ${[
        ['🛰️', 'Monitoramento via satélite', 'Índices NDVI, NDRE e NDWI da sua lavoura'],
        ['📸', 'Scan IA por foto', 'Diagnóstico instantâneo fotografando a área'],
        ['📋', 'Verificação de receitas', 'Valide receitas agronômicas com IA'],
        ['💰', 'Fluxo de caixa', 'Planeje receitas, custos e margem da safra'],
      ].map(([icon, title, desc]) => `
        <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:24px">${icon}</span>
          <div><strong style="color:#1c1917">${title}</strong><br><span style="color:#78716c;font-size:14px">${desc}</span></div>
        </div>`).join('')}

      <a href="https://solfarm.com.br/dashboard"
         style="display:block;background:#16a34a;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-weight:700;font-size:16px;margin-top:24px">
        Acessar minha conta →
      </a>
    </div>

    <p style="text-align:center;color:#a8a29e;font-size:12px">
      SolFarm · <a href="https://solfarm.com.br" style="color:#16a34a">solfarm.com.br</a>
    </p>
  </div>
</body>
</html>`,
  })
}

// ── Email: confirmação de exclusão de conta ───────────────────
export async function sendAccountDeleted(params: { toEmail: string; toName: string }) {
  const resend = getResend()
  if (!resend) return

  await resend.emails.send({
    from: FROM,
    to: params.toEmail,
    subject: 'Sua conta SolFarm foi excluída',
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f0ece4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#1c1917,#44403c);border-radius:16px;padding:32px;text-align:center;margin-bottom:20px">
      <div style="font-size:48px">🗑️</div>
      <h1 style="color:#fff;margin:12px 0 0;font-size:22px;font-weight:800">Conta Excluída</h1>
      <p style="color:rgba(255,255,255,0.7);margin:8px 0 0">Confirmação de exclusão de dados</p>
    </div>

    <div style="background:#fff;border-radius:16px;padding:28px;margin-bottom:16px">
      <p style="color:#44403c;font-size:16px">Olá, <strong>${params.toName.split(' ')[0]}</strong>,</p>
      <p style="color:#78716c;line-height:1.6">
        Confirmamos que sua conta no <strong>SolFarm</strong> foi <strong>permanentemente excluída</strong>.
        Todos os seus dados pessoais foram removidos dos nossos servidores, em conformidade com a
        <strong>LGPD (Lei Geral de Proteção de Dados)</strong>.
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin:20px 0">
        <p style="color:#991b1b;margin:0;font-size:14px;line-height:1.5">
          <strong>O que foi removido:</strong> perfil, áreas cadastradas, diagnósticos,
          histórico de monitoramento, carteira FarmCoin e publicações na comunidade.
        </p>
      </div>
      <p style="color:#78716c;font-size:14px;line-height:1.6">
        Se você não solicitou essa exclusão ou acredita que foi um engano, entre em contato
        imediatamente pelo e-mail <a href="mailto:contato@solfarm.com.br" style="color:#16a34a">contato@solfarm.com.br</a>.
      </p>
    </div>

    <p style="text-align:center;color:#a8a29e;font-size:12px">
      SolFarm · <a href="https://solfarm.com.br" style="color:#16a34a">solfarm.com.br</a>
    </p>
  </div>
</body>
</html>`,
  })
}

// ── Email: alerta de área crítica ─────────────────────────────
export async function sendCriticalAlert(params: {
  toEmail: string
  toName: string
  areaName: string
  score: number
  diagnosticId: string
}) {
  const resend = getResend()
  if (!resend) return

  await resend.emails.send({
    from: FROM,
    to: params.toEmail,
    subject: `🔴 Alerta: ${params.areaName} em estado crítico`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#fff5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);border-radius:16px;padding:32px;text-align:center;margin-bottom:20px">
      <div style="font-size:48px">🔴</div>
      <h1 style="color:#fff;margin:12px 0 0;font-size:22px;font-weight:800">Alerta de Saúde da Lavoura</h1>
    </div>
    <div style="background:#fff;border-radius:16px;padding:28px">
      <p style="color:#44403c">Olá, <strong>${params.toName.split(' ')[0]}</strong></p>
      <p style="color:#78716c">O diagnóstico da área <strong>${params.areaName}</strong> indicou estado <strong style="color:#dc2626">CRÍTICO</strong> com score <strong>${params.score}</strong>.</p>
      <p style="color:#78716c">Recomendamos verificar a área com urgência e consultar um agrônomo.</p>
      <a href="https://solfarm.com.br/dashboard/diagnostics/${params.diagnosticId}"
         style="display:block;background:#dc2626;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-weight:700;margin-top:20px">
        Ver diagnóstico completo →
      </a>
    </div>
  </div>
</body>
</html>`,
  })
}
