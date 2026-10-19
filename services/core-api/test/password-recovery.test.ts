import { Script } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

import { PasswordRecoveryController, renderPasswordRecoveryHtml } from '../src/auth/password-recovery.controller.js';
import type { CoreApiConfig } from '../src/config/core-api-config.js';

const issuer = 'https://vclsswwfhljczxgnsciq.supabase.co/auth/v1';
const key = 'sb_publishable_test_value_abcdefghijklmnopqrstuvwxyz0123456789';

function fakeReply() {
  const headers: Record<string, string> = {};
  let status = 200;
  let mime = '';
  let payload = '';
  const reply = {
    header(name: string, value: string) { headers[name.toLowerCase()] = value; return reply; },
    code(value: number) { status = value; return reply; },
    type(value: string) { mime = value; return reply; },
    send(value: string) { payload = value; return reply; },
  };
  return { reply, headers, get status() { return status; }, get mime() { return mime; }, get payload() { return payload; } };
}

afterEach(() => { delete process.env.DIALEKTIK_SUPABASE_PUBLISHABLE_KEY; });

describe('Dialektik password recovery browser flow', () => {
  it('uses only Supabase Auth endpoints and clears URL fragments before network requests', () => {
    const html = renderPasswordRecoveryHtml('https://vclsswwfhljczxgnsciq.supabase.co', key, 'knownnonce');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('name="password" type="password"');
    expect(html).toContain("callback.get('access_token')");
    expect(html).toContain("callback.get('type')");
    expect(html).toContain("recoveryType === 'recovery'");
    expect(html).toContain("window.history.replaceState(null, '', window.location.pathname)");
    expect(html).toContain("callAuth('recover?redirect_to='");
    expect(html).toContain("callAuth('user', {");
    expect(html).toContain("method: 'PUT'");
    expect(html).toContain("credentials: 'omit'");
    expect(html).toContain("referrerPolicy: 'no-referrer'");
    expect(html).not.toContain('localStorage.setItem');
    expect(html).not.toContain('sessionStorage.setItem');
    expect(html).not.toContain('<script src=');
    expect(html).toContain('nonce="knownnonce"');
    const inline = html.match(/<script nonce="knownnonce">([\s\S]*?)<\/script>/u);
    expect(inline?.[1]).toBeDefined();
    expect(() => new Script(inline![1]!)).not.toThrow();
  });

  it('escapes arbitrary runtime configuration so script structure cannot be broken', () => {
    const html = renderPasswordRecoveryHtml('https://supabase.co', 'a</script><script>evil()', 'some_nonce');
    expect(html).not.toContain('a</script><script>evil()');
    expect(html).toContain('\\u003c/script\\u003e');
  });

  it('fails closed without a valid public key, never enables recovery with a service key', () => {
    const controller = new PasswordRecoveryController({ supabaseAuthIssuer: issuer } as CoreApiConfig);
    for (const providedKey of [undefined, 'service_role_secret_key', 'sb_secret_abc', '']) {
      if (providedKey === undefined) delete process.env.DIALEKTIK_SUPABASE_PUBLISHABLE_KEY;
      else process.env.DIALEKTIK_SUPABASE_PUBLISHABLE_KEY = providedKey;
      const result = fakeReply();
      controller.recover(result.reply as never);
      expect(result.status).toBe(503);
      expect(result.payload).not.toContain('<script');
      expect(result.headers['cache-control']).toContain('no-store');
    }
  });

  it('enforces no-store, strict nonce-based CSP and Supabase-only connections', () => {
    process.env.DIALEKTIK_SUPABASE_PUBLISHABLE_KEY = key;
    const controller = new PasswordRecoveryController({ supabaseAuthIssuer: issuer } as CoreApiConfig);
    const result = fakeReply();
    controller.recover(result.reply as never);
    expect(result.status).toBe(200);
    expect(result.mime).toContain('text/html');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    expect(result.headers['x-frame-options']).toBe('DENY');
    expect(result.headers['content-security-policy']).toContain("default-src 'none'");
    expect(result.headers['content-security-policy']).toContain('connect-src https://vclsswwfhljczxgnsciq.supabase.co');
    expect(result.headers['content-security-policy']).toMatch(/script-src 'nonce-[^']+'/u);
    expect(result.headers['content-security-policy']).not.toContain("'unsafe-inline'");
    expect(result.payload).toContain('"supabaseUrl":"https://vclsswwfhljczxgnsciq.supabase.co"');
    expect(result.payload).toContain('"publishableKey":"sb_publishable_');
    expect(result.payload).not.toContain('service_role');
  });
});
