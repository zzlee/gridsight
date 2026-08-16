import crypto from 'crypto';

export class TokenAuthority {
  private activeTokens: Map<string, { token: string; ip: string; expiresAt: number }> = new Map();

  generateToken(mac: string, ip: string): string {
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
