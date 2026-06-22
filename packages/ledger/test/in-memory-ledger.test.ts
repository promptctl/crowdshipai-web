import { createInMemoryLedger } from '../src/index.js';
import { ledgerContract } from './ledger-contract.js';

// The in-memory fake must honour the same seam contract as the real engine, so it
// runs the shared suite in the fast, hermetic test run — proving adapter-level
// behaviour without standing up a database. The TigerBeetle integration suite runs
// the identical contract against the real engine [LAW:behavior-not-structure].
const ledger = createInMemoryLedger();
ledgerContract(() => ledger);
