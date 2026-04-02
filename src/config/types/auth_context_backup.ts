import { createContext } from 'react';

export type AuthUser = {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  name?: string;
  phoneNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  permissions?: any;
};

export type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  authenticated: boolean;
  unauthenticated: boolean;
  method: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  authenticated: false,
  unauthenticated: true,
  method: 'jwt',
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  refreshUser: () => Promise.resolve(),
});
