import type { Context, Next } from "hono";

/**
 * Create a basic auth middleware
 */
export function createAuthMiddleware(credentials: string | undefined) {
  // If no credentials provided, skip auth
  if (!credentials) {
    return async (_c: Context, next: Next) => {
      await next();
    };
  }

  const [username, password] = credentials.split(":");

  if (!username || !password) {
    console.warn(
      "Warning: Invalid auth format. Expected 'username:password'. Auth disabled."
    );
    return async (_c: Context, next: Next) => {
      await next();
    };
  }

  // Pre-compute the expected Authorization header value
  const expectedAuth = `Basic ${btoa(`${username}:${password}`)}`;

  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !timingSafeEqual(authHeader, expectedAuth)) {
      c.header("WWW-Authenticate", 'Basic realm="Documentation"');
      return c.text("Unauthorized", 401);
    }

    await next();
  };
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
