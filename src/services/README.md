# Services module

`intake.ts` normalizes assets, prepares drafts, and delegates confirmed mutations.
`dispatch.ts` owns confirmation, allocation, queue draining, resolution, and their transactions.
`technician-actions.ts` owns acknowledgement, start, and closure, and delegates capacity release.
`runtime.ts` wires shared layers.
