/**
 * A server auth configuration that cannot be honored. Thrown while the server
 * is being built, so the process refuses to start (fail closed) instead of
 * quietly running with less auth than whoever configured it asked for.
 *
 * Its message reaches the container log: it may name a variable or an email,
 * never a password or a secret.
 */
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    // Recognizable in a stack trace, like `IdentityAdminError`.
    this.name = 'AuthConfigError';
  }
}
