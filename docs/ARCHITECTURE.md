# Module boundaries

The accepted application design separates observations from deterministic operational decisions.
The application modules are not implemented yet.
Repository checks already enforce their import direction for future TypeScript sources.

| Module | Allowed internal dependencies |
| --- | --- |
| domain | domain |
| policy | policy, domain |
| repositories | repositories, domain, db |
| services | services, policy, domain, repositories, db |
| api | api, services, domain |
| db | db, domain |
| config | config |

Pure policy cannot import external packages or access clocks, randomness, network calls, process state, or timers.
Pass time and other variable facts as explicit inputs.
Use static imports so the gate can inspect dependencies.
Effect belongs in orchestration and boundary modules.

Assignment writes stay inside the dispatch transaction owner.
Repositories can provide reads without splitting transaction-critical writes across abstractions.
Read the [policy ADR](adr/0001-operational-policy-boundary.md) and [dispatch ADR](adr/0002-dispatch-transaction.md) before changing those decisions.

Build and source checks cover present files.
Empty module directories and accepted designs do not count as implemented features.
