import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class TokenAuthority {
  private activeTokens: Map<string, { token: string; ip: string; expiresAt: number }> = new Map();
  private hmacSecret: string = '';

  private normalizeMac(mac: string): string {
    return mac.trim().replace(/-/g, ':').toUpperCase();
  }

  /**
   * Load or generate the HMAC shared secret asynchronously using non-blocking I/O.
   * Persists to data/hmac_secret.txt so the same secret survives restarts
   * and existing agent deployments remain valid.
   */
  async getHmacSecret(dataDir?: string): Promise<string> {
    if (this.hmacSecret) return this.hmacSecret;

    const secretFile = dataDir
      ? path.join(dataDir, 'hmac_secret.txt')
      : path.resolve(process.cwd(), 'data', 'hmac_secret.txt');

    try {
      const data = await fs.promises.readFile(secretFile, 'utf-8');
      this.hmacSecret = data.trim();
      if (this.hmacSecret) return this.hmacSecret;
    } catch { /* fall through to generate */ }

    // Generate a new 32-byte (64 hex chars) random secret
    this.hmacSecret = crypto.randomBytes(32).toString('hex');

    try {
      const dir = path.dirname(secretFile);
      await fs.promises.mkdir(dir, { recursive: true });
      /* Atomic write via temp file + rename: a truncated secret file
       * would invalidate every issued token across restarts. */
      const tempFile = `${secretFile}.tmp-${process.pid}`;
      await fs.promises.writeFile(tempFile, this.hmacSecret, 'utf-8');
      await fs.promises.rename(tempFile, secretFile);
    } catch (err) {
      console.error('[TokenAuthority] Failed to persist HMAC secret:', err);
    }

    return this.hmacSecret;
  }

  /**
   * Compute HMAC-SHA256 signature for a TOKEN_GRANT reply.
   * Signature = HMAC-SHA256(secret, token + "|" + mac)
   */
  async signTokenGrant(token: string, mac: string): Promise<string> {
    const secret = await this.getHmacSecret();
    return crypto
      .createHmac('sha256', secret)
      .update(token + '|' + mac)
      .digest('hex');
  }

  generateToken(mac: string, ip: string): string {
    const normalizedMac = this.normalizeMac(mac);
    const existing = this.getToken(normalizedMac);
    if (existing) return existing;
    const token = crypto.randomBytes(24).toString('hex');
    this.activeTokens.set(normalizedMac, {
      token,
      ip,
      expiresAt: Date.now() + 1000 * 60 * 180, // 3 hours validity for class session
    });
    return token;
  }

  getToken(mac: string): string | undefined {
    const normalizedMac = this.normalizeMac(mac);
    const entry = this.activeTokens.get(normalizedMac);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.activeTokens.delete(normalizedMac);
      return undefined;
    }
    return entry.token;
  }

  validateToken(mac: string, token: string): boolean {
    if (!mac || !token) return false;
    const active = this.getToken(mac);
    if (!active || active.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(active), Buffer.from(token));
  }
}
