import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class TokenAuthority {
  private activeTokens: Map<string, { token: string; ip: string; expiresAt: number }> = new Map();
  private hmacSecret: string = '';

  /**
   * Load or generate the HMAC shared secret.
   * Persists to data/hmac_secret.txt so the same secret survives restarts
   * and existing agent deployments remain valid.
   */
  getHmacSecret(dataDir?: string): string {
    if (this.hmacSecret) return this.hmacSecret;

    const secretFile = dataDir
      ? path.join(dataDir, 'hmac_secret.txt')
      : path.resolve(process.cwd(), 'data', 'hmac_secret.txt');

    try {
      if (fs.existsSync(secretFile)) {
        this.hmacSecret = fs.readFileSync(secretFile, 'utf-8').trim();
        if (this.hmacSecret) return this.hmacSecret;
      }
    } catch { /* fall through to generate */ }

    // Generate a new 32-byte (64 hex chars) random secret
    this.hmacSecret = crypto.randomBytes(32).toString('hex');

    try {
      const dir = path.dirname(secretFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(secretFile, this.hmacSecret, 'utf-8');
    } catch (err) {
      console.error('[TokenAuthority] Failed to persist HMAC secret:', err);
    }

    return this.hmacSecret;
  }

  /**
   * Compute HMAC-SHA256 signature for a TOKEN_GRANT reply.
   * Signature = HMAC-SHA256(secret, token + "|" + mac)
   */
  signTokenGrant(token: string, mac: string): string {
    const secret = this.getHmacSecret();
    return crypto
      .createHmac('sha256', secret)
      .update(token + '|' + mac)
      .digest('hex');
  }

  generateToken(mac: string, ip: string): string {
    const existing = this.getToken(mac);
    if (existing) return existing;
    const token = crypto.randomBytes(24).toString('hex');
    this.activeTokens.set(mac, {
      token,
      ip,
      expiresAt: Date.now() + 1000 * 60 * 180, // 3 hours validity for class session
    });
    return token;
  }

  getToken(mac: string): string | undefined {
    const entry = this.activeTokens.get(mac);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.activeTokens.delete(mac);
      return undefined;
    }
    return entry.token;
  }

  validateToken(mac: string, token: string): boolean {
    const active = this.getToken(mac);
    return active === token;
  }
}
