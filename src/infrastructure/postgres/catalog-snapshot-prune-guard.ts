export interface CatalogSnapshotPruneGuardInput {
  service: string;
  redisKeyCount: number;
  normalizedDocumentCount: number;
  activeCatalogMarker: string | null;
  allowEmptyCatalogMigration: boolean;
}

export function assertCatalogSnapshotSafeForPrune(input: CatalogSnapshotPruneGuardInput): void {
  if (input.allowEmptyCatalogMigration) {
    return;
  }

  const problems = [
    input.redisKeyCount === 0 ? 'no Redis catalog keys matched catalog:*' : null,
    input.normalizedDocumentCount === 0 ? 'no normalized catalog documents were parsed' : null,
    input.activeCatalogMarker ? null : 'no active catalog marker was found',
  ].filter((problem): problem is string => Boolean(problem));

  if (problems.length === 0) {
    return;
  }

  throw new Error(
    `${input.service} catalog Postgres migration refused to prune stale rows: ${problems.join('; ')}. `
      + 'Check REDIS_URL and catalog readiness, or set ALLOW_EMPTY_CATALOG_POSTGRES_MIGRATION=true for an intentional empty snapshot.',
  );
}
