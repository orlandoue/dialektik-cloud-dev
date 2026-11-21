import { createSign } from 'node:crypto';

/**
 * Firebase Cloud Messaging (HTTP v1) with a service account, without the
 * Firebase SDK: an RS256 JWT is exchanged for a one-hour access token, which
 * is reused until five minutes before it expires.
 *
 * The service account JSON comes from FIREBASE_SERVICE_ACCOUNT_JSON (set by
 * the owner in Render, never in the repository). Without it nothing is sent.
 */
export interface ServiceAccount {
  readonly project_id: string;
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri?: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string })
  => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string>;
}

/** delivered; unregistered (forget the token); failed (try another day). */
export type SendOutcome = 'delivered' | 'unregistered' | 'failed';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (raw === undefined || raw.trim() === '') return null;
  try {
    const value = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof value.project_id !== 'string' || typeof value.client_email !== 'string'
      || typeof value.private_key !== 'string' || !value.private_key.includes('PRIVATE KEY')) return null;
    return value as ServiceAccount;
  } catch {
    return null;
  }
}

const base64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

export function signedAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(account.private_key))}`;
}

export class FcmSender {
  #access: { token: string; expiresAt: number } | undefined;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  get projectId(): string {
    return this.account.project_id;
  }

  async #accessToken(): Promise<string> {
    const now = this.now();
    if (this.#access !== undefined && now < this.#access.expiresAt - 5 * 60_000) return this.#access.token;
    const assertion = signedAssertion(this.account, Math.floor(now / 1000));
    const response = await this.fetcher(this.account.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (response.status !== 200) throw new Error(`FCM_AUTH_${response.status}`);
    const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') throw new Error('FCM_AUTH_NO_TOKEN');
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.#access = { token: body.access_token, expiresAt: now + seconds * 1000 };
    return body.access_token;
  }

  async send(deviceToken: string, message: PushMessage): Promise<SendOutcome> {
    const access = await this.#accessToken();
    const response = await this.fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: { priority: 'normal', notification: { channel_id: 'duelo_del_dia' } },
          },
        }),
      });
    if (response.status === 200) return 'delivered';
    // 404 UNREGISTERED, or 400 with an invalid token: the app is gone.
    if (response.status === 404) return 'unregistered';
    if (response.status === 400) {
      const text = await response.text().catch(() => '');
      if (/registration token|UNREGISTERED|INVALID_ARGUMENT.*token/iu.test(text)) return 'unregistered';
    }
    if (response.status === 401) this.#access = undefined;
    return 'failed';
  }
}
