# Keep assignment writes inside the dispatch transaction

The accepted design uses Postgres for the durable queue and keeps assignment writes inside DispatchService rather than distributing them across table-specific repositories.
Resolving work and assigning the next compatible queued work order share one transaction so a partial failure cannot release capacity without completing the associated state changes.
AssignmentRepository remains useful for reads, while the transaction owner exposes the lock order and related event writes together.
