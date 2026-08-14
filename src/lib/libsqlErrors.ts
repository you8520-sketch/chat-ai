export function isRetryableRemoteSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name|database is locked|schema (?:has )?changed|SQLITE_(?:BUSY|LOCKED)|cannot (?:rollback|commit) - no transaction is active/i.test(
    message
  );
}
