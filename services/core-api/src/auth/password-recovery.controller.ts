import { randomBytes } from 'node:crypto';

import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CORE_API_CONFIG, type CoreApiConfig } from '../config/core-api-config.js';

export const PASSWORD_RECOVERY_PATH = '/auth/recover';

/**
 * A strictly client-side Supabase recovery flow. The browser receives the
 * recovery token in the URL fragment, which is never sent to Core.
 * No password, bearer token or refresh token is posted to this backend.
 */
export function renderPasswordRecoveryHtml(
  supabaseUrl: string,
  publishableKey: string,
  nonce: string,
): string {
  const configJson = JSON.stringify({ supabaseUrl, publishableKey })
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex,nofollow">
  <title>Recuperar contraseña — Dialektik</title>
  <style nonce="${nonce}">
    :root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:#101720;color:#eef3fb}
    *{box-sizing:border-box}
    body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px}
    main{width:min(100%,440px);background:#1a2532;border:1px solid #344355;border-radius:18px;padding:30px}
    h1{font-size:1.7rem;margin:0 0 10px}p{line-height:1.5;color:#c5d1de}
    form{display:grid;gap:13px;margin-top:22px}
    label{display:grid;gap:7px;font-weight:600}
    input{border-radius:8px;border:1px solid #70849a;background:#0d1722;color:#fff;font:inherit;padding:11px}
    button{border:0;border-radius:8px;background:#79bbf8;color:#0a1724;font:inherit;font-weight:700;padding:12px;cursor:pointer}
    button:disabled{opacity:.5;cursor:wait}
    #status{min-height:24px;margin-top:16px;overflow-wrap:anywhere}
    [hidden]{display:none!important}
  </style>
</head>
<body>
<main>
  <h1>Dialektik</h1>
  <p>Recuperación segura de contraseña para la beta privada.</p>
  <section id="request-section">
    <form id="request-form" novalidate>
      <label for="email">Correo de tu cuenta
        <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
      </label>
      <button id="request-button" type="submit">Enviar enlace de recuperación</button>
    </form>
  </section>
  <section id="update-section" hidden>
    <p>Verificamos tu enlace. Establece una contraseña nueva.</p>
    <form id="update-form" novalidate>
      <label for="password">Nueva contraseña (mínimo 12 caracteres)
        <input id="password" name="password" type="password" autocomplete="new-password" required minlength="12">
      </label>
      <label for="confirm-password">Repetir contraseña
        <input id="confirm-password" name="confirm-password" type="password" autocomplete="new-password" required minlength="12">
      </label>
      <button id="update-button" type="submit">Guardar nueva contraseña</button>
    </form>
  </section>
  <p id="status" role="status" aria-live="polite"></p>
</main>
<script nonce="${nonce}">
'use strict';
(() => {
  const config = ${configJson};
  const status = document.getElementById('status');
  const requestSection = document.getElementById('request-section');
  const updateSection = document.getElementById('update-section');
  const requestForm = document.getElementById('request-form');
  const updateForm = document.getElementById('update-form');
  const requestButton = document.getElementById('request-button');
  const updateButton = document.getElementById('update-button');
  const callback = new URLSearchParams(window.location.hash.substring(1));
  const accessToken = callback.get('access_token');
  const recoveryType = callback.get('type');
  const callbackError = callback.get('error_code') || callback.get('error');

  // Erase the fragment before any asynchronous work; never retain tokens
  // in localStorage, sessionStorage, cookies, form fields or Core requests.
  window.history.replaceState(null, '', window.location.pathname);

  let recoveryToken = recoveryType === 'recovery' &&
    typeof accessToken === 'string' &&
    /^[A-Za-z0-9._~-]{50,8192}$/.test(accessToken) ? accessToken : null;

  function message(text) { status.textContent = text; }
  async function callAuth(path, opts) {
    return fetch(config.supabaseUrl + '/auth/v1/' + path, {
      ...opts,
      headers: {
        'apikey': config.publishableKey,
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error'
    });
  }

  if (callbackError) {
    message('Este enlace no es válido o ha expirado. Solicita uno nuevo aquí.');
  }

  if (recoveryToken) {
    requestSection.hidden = true;
    message('Verificando el enlace de recuperación…');
    callAuth('user', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + recoveryToken }
    }).then((response) => {
      if (!response.ok) throw new Error('invalid_recovery');
      updateSection.hidden = false;
      message('Introduce una contraseña nueva.');
    }).catch(() => {
      recoveryToken = null;
      requestSection.hidden = false;
      updateSection.hidden = true;
      message('El enlace de recuperación ya no es válido. Solicita uno nuevo.');
    });
  }

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      message('Introduce un correo válido.');
      return;
    }
    requestButton.disabled = true;
    message('Solicitando enlace…');
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const response = await callAuth('recover?redirect_to=' + encodeURIComponent(redirectTo), {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      if (response.status === 429 || response.status >= 500) {
        message('No se pudo procesar la solicitud. Inténtalo más tarde.');
      } else {
        // Deliberately do not reveal whether this account exists.
        message('Si la cuenta existe, recibirás un correo con un enlace. Usa el más reciente.');
      }
    } catch {
      message('No se pudo contactar con el servicio. Inténtalo más tarde.');
    } finally {
      requestButton.disabled = false;
    }
  });

  updateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!recoveryToken) {
      message('El enlace ya no está disponible. Solicita uno nuevo.');
      return;
    }
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirm-password');
    const newPassword = passwordInput.value;
    if (newPassword.length < 12 || newPassword !== confirmInput.value) {
      message('La contraseña debe tener al menos 12 caracteres y coincidir en ambos campos.');
      return;
    }
    updateButton.disabled = true;
    message('Actualizando contraseña…');
    try {
      const response = await callAuth('user', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + recoveryToken },
        body: JSON.stringify({ password: newPassword })
      });
      if (!response.ok) {
        message('No se pudo actualizar la contraseña. Verifica las reglas y solicita un enlace nuevo si caducó.');
        return;
      }
      // The token stays only in memory until success and is then discarded.
      recoveryToken = null;
      passwordInput.value = '';
      confirmInput.value = '';
      updateSection.hidden = true;
      message('Contraseña actualizada. Ya puedes abrir el APK de Dialektik e iniciar sesión.');
    } catch {
      message('No se pudo contactar con el servicio. Inténtalo nuevamente.');
    } finally {
      updateButton.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}

@Controller('auth')
export class PasswordRecoveryController {
  public constructor(@Inject(CORE_API_CONFIG) private readonly config: Readonly<CoreApiConfig>) {}

  @Get('recover')
  public recover(@Res() reply: FastifyReply): FastifyReply {
    const publishableKey = process.env.DIALEKTIK_SUPABASE_PUBLISHABLE_KEY?.trim();
    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (!publishableKey || !/^sb_publishable_[A-Za-z0-9_-]{12,256}$/u.test(publishableKey)) {
      return reply.code(503).type('text/plain; charset=utf-8').send(
        'Password recovery is temporarily unavailable.',
      );
    }

    const supabaseUrl = this.config.supabaseAuthIssuer.replace(/\/auth\/v1$/u, '');
    const nonce = randomBytes(18).toString('base64');
    reply.header('Content-Security-Policy', [
      "default-src 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "img-src 'none'",
      "font-src 'none'",
      "script-src 'nonce-" + nonce + "'",
      "style-src 'nonce-" + nonce + "'",
      'connect-src ' + supabaseUrl,
    ].join('; '));
    return reply.code(200).type('text/html; charset=utf-8')
      .send(renderPasswordRecoveryHtml(supabaseUrl, publishableKey, nonce));
  }
}
