import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../infra/config/env.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (!env.SMTP_USER || !env.SMTP_PASS) {
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return transporter;
}

function baseLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:'Nunito',Arial,sans-serif;background:#fdf4eb">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="text-align:center;margin-bottom:24px">
      <span style="font-size:24px;font-weight:700;color:#eb6464">Alegra</span>
      <span style="font-size:24px;font-weight:700;color:#fdc662">Festas</span>
    </div>
    <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #f0e1d4">
      <h1 style="font-size:20px;color:#241f1d;margin:0 0 16px">${title}</h1>
      ${body}
    </div>
    <p style="text-align:center;font-size:12px;color:#a99c92;margin-top:24px">
      Alegra Festas — Tudo para sua festa com qualidade e preco justo.
    </p>
  </div>
</body>
</html>`;
}

export class EmailService {
  async sendPasswordReset(to: string, name: string, resetUrl: string): Promise<void> {
    const html = baseLayout(
      'Recuperacao de Senha',
      `<p style="color:#564c47;line-height:1.6">Ola, <strong>${name}</strong>!</p>
       <p style="color:#564c47;line-height:1.6">Recebemos uma solicitacao para redefinir a senha da sua conta. Clique no botao abaixo para criar uma nova senha:</p>
       <div style="text-align:center;margin:24px 0">
         <a href="${resetUrl}" style="display:inline-block;padding:12px 32px;background:#eb6464;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Redefinir Senha</a>
       </div>
       <p style="color:#a99c92;font-size:13px">Este link expira em 1 hora. Se voce nao solicitou esta alteracao, ignore este e-mail.</p>`,
    );

    await this.send(to, 'Recuperacao de Senha - Alegra Festas', html);
  }

  async sendOrderConfirmed(
    to: string,
    name: string,
    orderId: string,
    totalAmount: number,
    itemCount: number,
  ): Promise<void> {
    const html = baseLayout(
      'Pedido Confirmado!',
      `<p style="color:#564c47;line-height:1.6">Ola, <strong>${name}</strong>!</p>
       <p style="color:#564c47;line-height:1.6">Seu pagamento foi aprovado e seu pedido esta sendo preparado.</p>
       <div style="background:#fdf4eb;border-radius:8px;padding:16px;margin:16px 0">
         <p style="margin:4px 0;color:#564c47"><strong>Pedido:</strong> #${orderId.slice(0, 8).toUpperCase()}</p>
         <p style="margin:4px 0;color:#564c47"><strong>Itens:</strong> ${itemCount} produto(s)</p>
         <p style="margin:4px 0;color:#564c47"><strong>Total:</strong> R$ ${totalAmount.toFixed(2)}</p>
       </div>
       <p style="color:#564c47;line-height:1.6">Voce pode acompanhar o status do seu pedido na area <a href="${env.CORS_ORIGIN}/meus-pedidos" style="color:#019d9c;font-weight:600">Meus Pedidos</a>.</p>`,
    );

    await this.send(to, 'Pedido Confirmado - Alegra Festas', html);
  }

  async sendOrderShipped(
    to: string,
    name: string,
    orderId: string,
    trackingCode: string,
    carrier: string,
  ): Promise<void> {
    const html = baseLayout(
      'Pedido Enviado!',
      `<p style="color:#564c47;line-height:1.6">Ola, <strong>${name}</strong>!</p>
       <p style="color:#564c47;line-height:1.6">Seu pedido foi enviado e esta a caminho!</p>
       <div style="background:#fdf4eb;border-radius:8px;padding:16px;margin:16px 0">
         <p style="margin:4px 0;color:#564c47"><strong>Pedido:</strong> #${orderId.slice(0, 8).toUpperCase()}</p>
         <p style="margin:4px 0;color:#564c47"><strong>Transportadora:</strong> ${carrier}</p>
         <p style="margin:4px 0;color:#564c47"><strong>Codigo de Rastreio:</strong> ${trackingCode}</p>
       </div>
       <p style="color:#564c47;line-height:1.6">Acompanhe a entrega em <a href="${env.CORS_ORIGIN}/meus-pedidos" style="color:#019d9c;font-weight:600">Meus Pedidos</a>.</p>`,
    );

    await this.send(to, 'Pedido Enviado - Alegra Festas', html);
  }

  async sendReviewReminder(
    to: string,
    name: string,
    orderId: string,
  ): Promise<void> {
    const orderCode = orderId.slice(0, 8).toUpperCase();
    const myOrdersUrl = `${env.PUBLIC_SITE_URL}/meus-pedidos`;
    const html = baseLayout(
      'Como foi sua festa?',
      `<p style="color:#564c47;line-height:1.6">Ola, <strong>${name}</strong>!</p>
       <p style="color:#564c47;line-height:1.6">Como foi sua festa? Avalie os produtos do pedido <strong>#${orderCode}</strong> e ajude outros clientes a escolher com confianca.</p>
       <div style="text-align:center;margin:24px 0">
         <a href="${myOrdersUrl}" style="display:inline-block;padding:12px 32px;background:#eb6464;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px">Avaliar Produtos</a>
       </div>
       <p style="color:#a99c92;font-size:13px">Voce recebe este lembrete uma unica vez, alguns dias apos a entrega.</p>`,
    );

    await this.send(to, `Avalie os produtos do pedido #${orderCode} - Alegra Festas`, html);
  }

  async sendContactForm(
    fromName: string,
    fromEmail: string,
    subject: string,
    message: string,
  ): Promise<void> {
    const html = baseLayout(
      `Contato: ${subject || 'Sem assunto'}`,
      `<p style="color:#564c47;line-height:1.6"><strong>Nome:</strong> ${fromName}</p>
       <p style="color:#564c47;line-height:1.6"><strong>E-mail:</strong> ${fromEmail}</p>
       <p style="color:#564c47;line-height:1.6"><strong>Mensagem:</strong></p>
       <div style="background:#fdf4eb;border-radius:8px;padding:16px;margin:8px 0">
         <p style="color:#564c47;line-height:1.6;white-space:pre-wrap">${message}</p>
       </div>`,
    );

    const adminEmail = env.SMTP_USER || 'contato@alegrafestas.com.br';
    await this.send(adminEmail, `[Contato] ${subject || 'Nova mensagem'}`, html, fromEmail);
  }

  private async send(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
    const transport = getTransporter();

    const info = await transport.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });

    if (env.NODE_ENV === 'development') {
      const messageData = (info as { message?: string }).message;
      if (messageData) {
        const parsed = JSON.parse(messageData) as { subject: string; to: Array<{ address: string }> };
        const { logger: log } = await import('../../shared/utils/logger.js');
        log.info({ subject: parsed.subject, to: parsed.to.map((t) => t.address) }, 'Email sent (dev)');
      }
    }
  }
}
