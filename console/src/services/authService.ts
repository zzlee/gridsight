const TOKEN_KEY = 'gridsight_teacher_token';

export const AuthService = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  },

  setToken(token: string, remember: boolean = true) {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
  },

  clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  },

  async login(pin: string, remember: boolean = true): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await resp.json();
      if (resp.ok && data.token) {
        this.setToken(data.token, remember);
        return { success: true };
      }
      return { success: false, error: data.error || 'PIN 碼錯誤' };
    } catch (e) {
      return { success: false, error: '無法連線至伺服器' };
    }
  },

  async verify(): Promise<boolean> {
    const token = this.getToken();
    if (!token) return false;
    try {
      const resp = await fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        return !!data.authenticated;
      }
      return false;
    } catch {
      return false;
    }
  },

  async changePin(currentPin: string, newPin: string): Promise<{ success: boolean; error?: string }> {
    const token = this.getToken();
    try {
      const resp = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        return { success: true };
      }
      return { success: false, error: data.error || '修改失敗' };
    } catch {
      return { success: false, error: '網路連線異常' };
    }
  },

  async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const token = this.getToken();
    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(url, { ...options, headers });
  },
};
