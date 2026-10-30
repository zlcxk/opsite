import nodemailer from 'nodemailer';
import type { SmtpConfigView, SmtpEncryption } from '../../shared/types.js';
import { db, nowIso } from '../db.js';
import { decryptSecret, encryptSecret } from '../lib/secret.js';

interface SmtpRow {
  enabled: number;
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  password_ciphertext: string | null;
  from_name: string;
  from_email: string;
  updated_at: string;
}

export interface SmtpConfigInternal {
  enabled: boolean;
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  password: string | null;
  fromName: string;
  fromEmail: string;
}

export interface SmtpConfigInput {
  enabled?: boolean;
  host?: string;
  port?: number;
  encryption?: SmtpEncryption;
  username?: string;
  password?: string;
  fromName?: string;
  fromEmail?: string;
}

const EMPTY: SmtpRow = {
  enabled: 0,
  host: '',
  port: 587,
  encryption: 'starttls',
  username: '',
  password_ciphertext: null,
  from_name: 'Opsite',
  from_email: '',
  updated_at: '',
};

function readRow(): SmtpRow {
  const row = db.prepare('SELECT * FROM smtp_config WHERE id = 1').get() as SmtpRow | undefined;
  return row ?? EMPTY;
}

export function getSmtpConfigView(): SmtpConfigView {
  const row = readRow();
  return {
    configured: Boolean(row.host && row.from_email && (!row.username || row.password_ciphertext)),
    enabled: Boolean(row.enabled),
    host: row.host,
    port: row.port,
    encryption: row.encryption,
    username: row.username,
    fromName: row.from_name,
    fromEmail: row.from_email,
    passwordConfigured: Boolean(row.password_ciphertext),
    updatedAt: row.updated_at || null,
  };
}

export function getSmtpConfigInternal(): SmtpConfigInternal | null {
  const row = readRow();
  if (!row.host || !row.from_email) return null;
  let password: string | null = null;
  if (row.password_ciphertext) {
    try {
      password = decryptSecret(row.password_ciphertext);
    } catch {
      throw new Error('SMTP 密码无法解密，请在设置中重新填写密码');
    }
  }
  return {
    enabled: Boolean(row.enabled),
    host: row.host,
    port: row.port,
    encryption: row.encryption,
    username: row.username,
    password,
    fromName: row.from_name,
    fromEmail: row.from_email,
  };
}

export function saveSmtpConfig(input: SmtpConfigInput): SmtpConfigView {
  const current = readRow();
  const next = {
    enabled: input.enabled ?? Boolean(current.enabled),
    host: input.host ?? current.host,
    port: input.port ?? current.port,
    encryption: input.encryption ?? current.encryption,
    username: input.username ?? current.username,
    password_ciphertext: current.password_ciphertext,
    from_name: input.fromName ?? current.from_name,
    from_email: input.fromEmail ?? current.from_email,
    updated_at: nowIso(),
  };

  if (input.password) next.password_ciphertext = encryptSecret(input.password);

  db.prepare(
    `INSERT INTO smtp_config
      (id, enabled, host, port, encryption, username, password_ciphertext, from_name, from_email, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled, host = excluded.host, port = excluded.port,
       encryption = excluded.encryption, username = excluded.username,
       password_ciphertext = excluded.password_ciphertext,
       from_name = excluded.from_name, from_email = excluded.from_email,
       updated_at = excluded.updated_at`,
  ).run(
    next.enabled ? 1 : 0,
    next.host,
    next.port,
    next.encryption,
    next.username,
    next.password_ciphertext,
    next.from_name,
    next.from_email,
    next.updated_at,
  );

  return getSmtpConfigView();
}

export function sanitizeSmtpError(error: unknown, password?: string | null): string {
  const value = error as { code?: string; response?: string; message?: string };
  let message = [value.code, value.response || value.message]
    .filter(Boolean)
    .join(' · ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!message) message = 'SMTP 发送失败';
  if (password) message = message.split(password).join('***');
  return message.slice(0, 500);
}

export async function sendSmtpMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const config = getSmtpConfigInternal();
  if (!config) throw new Error('SMTP 尚未配置');
  if (!config.enabled) throw new Error('SMTP 已停用');

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.encryption === 'ssl',
    requireTLS: config.encryption === 'starttls',
    ignoreTLS: config.encryption === 'none',
    auth: config.username
      ? { user: config.username, pass: config.password ?? '' }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 25_000,
  });

  try {
    await transporter.sendMail({
      from: {
        name: config.fromName || 'Opsite',
        address: config.fromEmail,
      },
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } finally {
    transporter.close();
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
