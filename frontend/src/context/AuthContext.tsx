import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, tokens } from '../lib/api';
import type { Role, User } from '../lib/types';

type AuthPayload = { user: User; access_token: string; refresh_token: string };

type RegisterInput = {
  name: string;
  email: string;
  password: string;
  organization?: string;
  phone?: string;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  updateProfile: (input: { name?: string; organization?: string | null; phone?: string | null }) => Promise<void>;
  isStaff: boolean;
  hasRole: (...roles: Role[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on first paint so a refresh keeps you logged in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokens.access) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<User>('/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        tokens.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback((payload: AuthPayload) => {
    tokens.set(payload.access_token, payload.refresh_token);
    setUser(payload.user);
    return payload.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) =>
      accept(await api.post<AuthPayload>('/auth/login', { email, password })),
    [accept],
  );

  const register = useCallback(
    async (input: RegisterInput) => accept(await api.post<AuthPayload>('/auth/register', input)),
    [accept],
  );

  const logout = useCallback(async () => {
    const refresh = tokens.refresh;
    try {
      if (refresh) await api.post('/auth/logout', { refresh_token: refresh });
    } catch {
      /* logging out locally is enough */
    }
    tokens.clear();
    setUser(null);
  }, []);

  const updateProfile = useCallback(
    async (input: { name?: string; organization?: string | null; phone?: string | null }) => {
      setUser(await api.patch<User>('/auth/me', input));
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      updateProfile,
      isStaff: user?.role === 'admin' || user?.role === 'reviewer',
      hasRole: (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    }),
    [user, loading, login, register, logout, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
