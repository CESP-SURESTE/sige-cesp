import { platformFetch } from './platform-http';

export function loginPlatformAdmin(
  email: string,
  password: string,
): Promise<{ token: string }> {
  return platformFetch<{ token: string }>('/platform-admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}
