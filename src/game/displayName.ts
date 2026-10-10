/** Name fields accept pasted emails, but their domain is not part of the name. */
export function stripDisplayNameEmailSuffix(raw: string): string {
  const at = raw.indexOf('@');
  return at === -1 ? raw : raw.slice(0, at);
}
