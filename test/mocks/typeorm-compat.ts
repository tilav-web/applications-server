// TypeORM v1+ removed Connection and AbstractRepository; this CJS-safe shim
// mirrors @nestjs/typeorm's ESM-only typeorm-compat.js during Jest runs.
export const Connection = undefined;
export const AbstractRepository = undefined;
