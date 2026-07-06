export function validateAuthEnvironment(): void {
  if (process.env.NODE_ENV !== "production") return;

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret) {
    throw new Error(
      "SESSION_SECRET must be set in production and kept stable across deploys/restarts."
    );
  }
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production.");
  }
}
