# VoiceOps design record

This record consolidates the supplied conversation, attachment, and accepted recommendations through Q98.
These are design decisions, not claims of implemented or tested behavior.
Later explicit choices supersede earlier recommendations.

## Accepted scope

- Build a synthetic maintenance work-order intake and dispatch proof of concept for an ElevenLabs engineering portfolio.
- Use an ElevenLabs-hosted voice interface with asset lookup and maintenance history.
- Use TypeScript, Effect v4, Effect Schema, Effect HttpApi, Effect SQL, Postgres, and PgMigrator.
- Run Postgres through Docker Compose, with a local API exposed temporarily for the voice demonstration.
- Keep policy functions pure and isolate priority, skill mapping, duplicate rules, and lifecycle transitions.
- Use IntakeService, DispatchService, and TechnicianActionService for orchestration.
- Keep assignment writes visibly inside the dispatch transaction, with AssignmentRepository used for reads.
- Keep an append-only event history alongside current operational state.
- Demonstrate a successful voice intake and automatic assignment of queued work after a technician resolves an existing job.
- Verify pure policy, backend integration, real-Postgres concurrency, and voice behavior separately.
- Mention durable distributed workflows only as a possible future extension.
- Present the demo through the hosted voice agent, terminal output, and technician CLI.

The exact Effect package versions and API availability require verification before implementation.
The pasted claim about a specific Effect stable release date is not verified here.

## Accepted workflow rules

- Preparation validates observations, determines priority, checks for duplicates, and produces a draft before confirmation.
- Drafts expire after five minutes.
- Voice intake can prepare, confirm, and resolve duplicate reports, but cannot perform technician lifecycle actions.
- The lifecycle is NEW, VALIDATED, PRIORITIZED, ASSIGNED, ACKNOWLEDGED, IN_PROGRESS, RESOLVED, and CLOSED.
- Queued work remains PRIORITIZED with a separate dispatch status.
- Queue order is CRITICAL, HIGH, MEDIUM, then LOW, with oldest first within a priority.
- Each technician has a set of skills and at most one active assignment.
- Availability derives from active assignments rather than a separate availability flag.
- Allocation prefers the least recently assigned eligible technician.
- Resolving a work order releases capacity and assigns the next compatible queued job within one transaction.
- Queued work does not reserve capacity.
- Critical work with no eligible technician remains queued and raises an escalation flag and event.
- Critical work does not preempt an active assignment.
- A possible duplicate is any unresolved work order with the same asset and fault category, regardless of age.
- A confirmed same-issue report adds observations and increments report_count.
- A confirmed new occurrence produces a separate work order.
- Unresolved fault classification requires manual review and blocks automatic dispatch.
- Verbal confirmation remains model-mediated, with conversational tests checking the agent's behavior.
- Unreported safety-relevant facts remain unknown rather than defaulting to false.
- The agent asks for required facts, and incomplete requests remain held for manual review without automatic dispatch.
- Manual review ends the automated flow in this PoC, with no reviewer workflow to implement.
- Same-issue follow-up reports recalculate priority and update queue ordering and escalation as needed, without automatically lowering priority.
- An already assigned work order retains its technician when a follow-up report raises urgency.
- Assignment clears the capacity-related escalation flag while retaining the escalation history.
- Clearing that flag does not mean the underlying hazard has been resolved.

## Synthetic world

Assets are P-101, C-201, and V-301.
Tech-01 has mechanical and rotating-equipment skills.
Tech-02 has electrical skills.
Tech-03 has mechanical and instrumentation skills.
Historical work orders provide duplicate candidates and occupied capacity for the queue demonstration.

## Superseded choices

Effect replaces FastAPI, SQLAlchemy, and Alembic.
Postgres replaces runtime-only state loaded from JSON.
The unresolved-work rule replaces the 24-hour duplicate window.
Prepare and confirm replace a single create-and-dispatch operation.
Pure policy functions replace PriorityService and DuplicateService.
The hosted voice agent, terminal output, and technician CLI replace the optional thin web interface for this PoC.

## Final design round

| Settled branch | Accepted decision | Downstream contract |
| --- | --- | --- |
| Verbal confirmation and two-phase intake | Q94 A: model-mediated consent | Test conversational behavior without claiming independently enforced approval |
| Constrained observation extraction | Q95 B: preserve unknown facts | Clarify required facts or hold for manual review |
| Same-issue reports enrich existing work | Q96 B: recalculate urgency | Update priority, queue ordering, and escalation without automatic downgrade |
| Critical queued work raises escalation | Q97 A: clear on assignment | Preserve history and distinguish capacity from hazard resolution |
| Hosted voice and technician simulation | Q98 A: terminal and CLI | No web interface in the implementation scope |

The user accepted all five recommendations on 2026-10-03.
The current product-decision frontier is closed.
Implementation details and verification remain outstanding.

## Implementation obligations

An agent-callable confirm operation alone does not independently verify human consent.
The final documentation must describe the actual confirmation guarantee.

An assignment must consume capacity from ASSIGNED onward, including before acknowledgement.
Only counting ACKNOWLEDGED and IN_PROGRESS would violate the accepted one-job limit.

The implementation must define deterministic tie-breakers, retry behavior, and database constraints.
Concurrency tests must cover double assignment, duplicate confirmations, and release racing with new intake.
Confirmation must recheck mutable conditions rather than assume preparation remains current.
These are correctness obligations, not reasons to add more product scope.

No working voice call, test result, deployment, or demo recording exists as evidence in this workspace.
