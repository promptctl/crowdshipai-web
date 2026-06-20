import { createFakeCatalog } from './fake-catalog';
import type { CrowdCatalog } from './types';

/**
 * The single place the app decides which CrowdCatalog it runs against
 * [LAW:one-source-of-truth]. Every page reads through `getCatalog()`, so
 * swapping the in-memory fake for real services is a one-line change here and
 * nowhere else [LAW:single-enforcer].
 */
const catalog: CrowdCatalog = createFakeCatalog();

export const getCatalog = (): CrowdCatalog => catalog;
