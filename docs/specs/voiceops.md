# VoiceOps: voice intake and deterministic maintenance dispatch

## Problem Statement

Sam needs a small ElevenLabs project that demonstrates useful enterprise integration and sound backend judgment.
The artifact must let a recruiter understand the result and let an engineer inspect evidence of correct behavior.

In the simulated facility, operators report equipment faults verbally.
Those reports can omit facts, repeat unresolved issues, or arrive when no compatible technician is available.
The system must preserve uncertainty and allocate work without inventing diagnoses, technicians, or operational instructions.

## Solution

Build a synthetic maintenance intake and dispatch proof of concept called VoiceOps.
An ElevenLabs-hosted voice agent gathers observations, retrieves asset context, and asks for missing facts.
The backend prepares a draft and returns its priority, duplicate candidates, and dispatch eligibility.
The agent summarizes the request and asks for verbal confirmation before it requests creation or a duplicate update.

Deterministic rules govern priority, required skills, duplicate matching, and lifecycle transitions.
Postgres stores operational state and the ordered queue.
When a technician resolves current work, the backend assigns the next compatible queued work order in the same transaction.

The demo combines a voice conversation with terminal output and technician CLI actions.
It shows successful intake and automatic assignment after capacity becomes available.

## User Stories

1. As a portfolio author, I want a working ElevenLabs integration, so that reviewers can inspect an actual workflow.
2. As a recruiter, I want a short demo, so that I can understand the project without reading its implementation.
3. As an engineer, I want reproducible tests, so that I can assess the project's correctness claims.
4. As an operator, I want to report a fault by voice, so that I can describe observations without completing a form.
5. As an operator, I want asset identifiers normalized, so that ordinary spoken variants match the synthetic registry.
6. As an operator, I want clarification when an asset identifier is missing, so that the system does not guess the equipment.
7. As an operator, I want unknown equipment identified, so that the agent does not invent asset records.
8. As an operator, I want recent maintenance context, so that I can recognize an existing issue.
9. As an operator, I want observations recorded without a diagnosis, so that the request reflects what I actually reported.
10. As an operator, I want unreported conditions preserved as unknown, so that silence does not imply safety.
11. As an operator, I want questions about required facts, so that the backend receives enough information for dispatch.
12. As an operator, I want a manual-review hold when facts remain incomplete, so that the system does not force an assignment.
13. As an operator, I want unclear fault categories held for manual review, so that the agent does not select an unsupported category.
14. As an operator, I want a prepared summary, so that I can check the asset and observations before confirmation.
15. As an operator, I want a verbal confirmation request, so that I can decline creation before the agent requests dispatch.
16. As an operator, I want expired drafts rejected, so that an old proposal cannot produce unexpected work.
17. As an operator, I want a possible duplicate explained, so that I can identify the same issue or a new occurrence.
18. As an operator, I want same-issue observations added to existing work, so that the report history remains together.
19. As an operator, I want a new occurrence recorded separately, so that unrelated reports are not silently merged.
20. As an operator, I want worsening observations to raise urgency, so that an existing report does not hide a more serious condition.
21. As an operator, I want the result stated accurately, so that I know whether work is assigned, queued, or held.
22. As a technician, I want assignments that match my skills, so that I receive compatible work.
23. As a technician, I want one active assignment at a time, so that dispatch respects my capacity.
24. As a technician, I want assigned work to consume capacity before acknowledgement, so that another request cannot double-book me.
25. As a technician, I want to acknowledge assigned work, so that the recorded lifecycle reflects my response.
26. As a technician, I want to start acknowledged work, so that the system records field work in progress.
27. As a technician, I want to resolve current work, so that the system releases my capacity.
28. As a technician, I want the next compatible queued work assigned after resolution, so that waiting work can proceed.
29. As an administrator in the simulation, I want to close resolved work separately, so that administrative review does not block capacity.
30. As an operator, I want urgent queued work selected first, so that priority determines allocation.
31. As an operator, I want older work selected first within a priority, so that equal-priority work has a predictable order.
32. As a technician, I want queued work to reserve no capacity, so that availability reflects actual assignments.
33. As an operator, I want a critical queued work order to raise escalation, so that its capacity problem is visible.
34. As an operator, I want escalation history retained after assignment, so that reviewers can explain the earlier delay.
35. As a technician, I want active work protected from automatic preemption, so that a new report does not silently replace my assignment.
36. As an engineer, I want repeated confirmation to produce one result, so that retries do not create duplicate assignments.
37. As an engineer, I want concurrent requests tested against Postgres, so that locking claims have direct evidence.
38. As an engineer, I want failed transactions to leave no partial assignment, so that state remains consistent.
39. As a reviewer, I want event history with decision reasons, so that I can explain priority, queuing, and assignment.
40. As a portfolio author, I want only synthetic data, so that the demo contains no employer records or procedures.
41. As a reviewer, I want the confirmation limitation stated, so that I can distinguish tested agent behavior from independent human approval.
42. As a developer, I want reproducible seed data, so that I can repeat the documented scenarios.

## Implementation Decisions

- Use TypeScript, Effect v4, Effect Schema, Effect HttpApi, Effect SQL, Postgres, and PgMigrator.
- Verify compatible package versions and imports before implementation, then pin the versions used.
- Use Docker Compose for Postgres and one local API process.
- Expose the API temporarily for the ElevenLabs demonstration.
- Use pure policy functions for priority, skill mapping, duplicate decisions, and valid transitions.
- Use IntakeService for preparation, duplicate resolution, and confirmation.
- Use DispatchService for queue selection and assignment transactions.
- Use TechnicianActionService for acknowledgement, start, resolution, and closure.
- Use repositories for asset context, work-order queries, technician queries, assignment reads, and general event access.
- Keep assignment writes and related event writes together in the transaction owner.
- Use tagged domain failures and explicit HTTP outcomes for invalid input, missing records, expired drafts, and invalid transitions.
- Treat queuing and manual review as expected domain outcomes rather than server failures.
- Protect agent tool requests with a configured tool credential.
- Keep technician actions outside the voice agent's tool permissions.

### Observation and policy contracts

Observation input contains an asset identifier, fault category, free-text observations, equipment operating status, leak significance, fire or smoke, and personnel hazard.
Vibration and temperature observations use bounded severity values.
Each safety-relevant fact can remain unknown.
The backend must distinguish unknown values from explicit negative observations.

Supported categories are abnormal vibration, temperature issue, mechanical leak, electrical fault, instrumentation fault, and performance degradation.
An unclassified report requires clarification or manual review.
The backend maps the category to one required skill.

Priority follows the highest applicable rule.

| Priority | Reported conditions |
| --- | --- |
| CRITICAL | Personnel hazard, fire or smoke, or a significant active leak |
| HIGH | Equipment unavailable, severe vibration, or severe overheating |
| MEDIUM | Abnormal vibration, abnormal temperature, or degraded performance while equipment operates |
| LOW | A minor defect or routine corrective request with no higher condition |

Missing facts cannot justify a lower priority.
Preparation must return the facts still required for automatic dispatch.
An incomplete request can remain held for manual review, even when a known fact already establishes urgency.

### Intake and duplicate contracts

Asset-context retrieval returns registry information and relevant maintenance history.
Preparation returns an expiring draft, a possible-duplicate result, or a manual-review hold.
An eligible draft includes the normalized observations, derived priority, required skill, and expiry time.
Preparation does not allocate a technician.

Confirmation operates on a draft identifier and rechecks expiry and mutable dispatch conditions.
It returns the resulting work order and its assigned, queued, or held outcome.
Repeated confirmation of the same draft must return the existing result without another assignment.

A possible duplicate has the same asset and fault category as an unresolved work order.
There is no age cutoff.
The operator chooses whether the report describes the same issue or a new occurrence.
The backend must recheck duplicate conditions during mutation because preparation can become stale.

A same-issue update preserves observations, increments report_count, and records the report event.
It recalculates urgency without automatically reducing existing priority.
It updates queue order and escalation where applicable.
An assigned work order retains its technician when urgency increases.
An explicit new occurrence becomes a separate work order.

The agent asks for verbal confirmation before a mutation request.
This confirmation is model-mediated.
Separate prepare and confirm operations do not independently prove that the user consented.
Conversational tests and the README must describe that limitation accurately.

### Persistence and lifecycle contracts

Persist work orders, technicians, assignments, and an append-only event history.
Persist drafts or equivalent preparation records with expiry and confirmation results.
Seed asset reference data and synthetic maintenance history reproducibly.
No complete inventory or personnel management model is required.

Work-order records include observations, priority, required skill, lifecycle status, dispatch status, escalation status, report count, and timestamps.
Assignment records identify the work order, technician, allocation time, and release time.
Events identify the affected work order, action, time, and decision reason.

The lifecycle advances through NEW, VALIDATED, PRIORITIZED, ASSIGNED, ACKNOWLEDGED, IN_PROGRESS, RESOLVED, and CLOSED.
Queued work remains PRIORITIZED with a separate QUEUED dispatch status.
Manual-review holds remain ineligible for automatic dispatch.
Draft expiry is separate from the confirmed work-order lifecycle.

An assignment consumes technician capacity immediately at ASSIGNED.
Capacity remains occupied through ACKNOWLEDGED and IN_PROGRESS.
RESOLVED releases capacity, while CLOSED records later administrative review.
Invalid lifecycle actions must fail without partial mutation.

### Queue and concurrency contracts

Postgres is the durable queue.
Select compatible queued work by priority, then creation time.
Use a stable identifier to resolve equal timestamps deterministically.
Choose among available compatible technicians by least recent assignment, then a stable identifier.

Queued work does not reserve a technician.
New intake must not bypass higher-priority compatible queued work during allocation.
Critical queued work raises a capacity-related escalation flag and event.
Assignment clears the flag and preserves the history.
It does not establish that the underlying hazard is resolved.
There is no automatic preemption.

Use one consistent lock order for allocation and release paths.
Protect technician capacity and work-order allocation with transaction locks and database constraints.
The constraints must prevent multiple active assignments for one technician or one work order.

Resolution releases the current assignment, changes the lifecycle, selects the next compatible queued work, and records events within one transaction.
A failure must roll back all those changes.
Concurrent intake and resolution must not lose queued work or allocate capacity twice.
Document any queue-order effects of the chosen locking strategy.

### Synthetic world and presentation

Use assets P-101, C-201, and V-301.
Tech-01 has mechanical and rotating-equipment skills.
Tech-02 has electrical skills.
Tech-03 has mechanical and instrumentation skills.
Seed unresolved work for duplicate scenarios and occupied capacity for queue scenarios.

Expose workflow actions for asset context, preparation, confirmation, duplicate updates, acknowledgement, start, resolution, and closure.
Use a technician CLI for acknowledge, start, resolve, and close actions.
Show work-order outcomes, current assignments, queue order, and event history through terminal output.
The hosted voice agent remains the operator interface.

## Testing Decisions

The accepted main test boundary is the public HTTP API connected to real Postgres.
Exercise complete workflows and inspect observable responses, persisted outcomes, and event history.
Do not assert private call sequences, repository method names, or incidental implementation structure.

No application code or existing tests are present in this workspace.
There is no existing test boundary or codebase precedent to reuse.
The proposed boundaries preserve the previously accepted backend, policy, and voice verification requirements.

- Test IntakeService, DispatchService, and TechnicianActionService primarily through the HTTP API.
- Use table tests for pure priority, skill, duplicate, and transition policy.
- Use separate ElevenLabs conversation tests for clarification, summaries, confirmation behavior, and tool selection.
- Use real Postgres for transaction, retry, and concurrency tests.
- Use controlled synthetic fixtures and explicit timestamps for deterministic queue tests.
- Confirm that data remains available after an API restart.
- Verify that unknown assets and incomplete facts cannot produce automatic assignments.
- Verify draft expiry and repeated confirmation without duplicate mutation.
- Verify both duplicate branches and worsening observations without automatic priority downgrade.
- Verify compatible assignment and capacity consumption before acknowledgement.
- Verify priority order, age order, stable ties, and least-recent assignment selection.
- Verify that critical queued work raises escalation and assignment clears only the current flag.
- Verify resolution-triggered assignment and rollback after a transaction failure.
- Race two allocation requests for one available technician.
- Race confirmation requests for one draft.
- Race new intake with technician resolution.
- Verify invalid transitions and attempts to invoke technician actions through agent credentials.

Use five conversational scenarios: complete intake, missing asset identifier, unknown equipment, explicit emergency conditions, and ambiguous observations.
Include the verbal confirmation requirement in relevant scenario assertions.
Voice tests must not substitute for database concurrency evidence.

The main demonstration uses the same workflow boundaries as integration tests.
One clip shows voice intake through assignment.
Another shows a queued HIGH-priority work order assigned after the CLI resolves current work.
The recording must show actual tool execution and persisted results.

The user accepted the test boundaries by instructing the agent to proceed on 2026-10-03.

## Out of Scope

- A dashboard, technician web view, or custom voice frontend.
- User accounts, login screens, or production identity management.
- Real employer data, real operating procedures, or autonomous diagnosis.
- Real technician contact, dispatch notifications, or CMMS integration.
- A supervisor or manual-review workflow.
- Scheduling, shifts, certification levels, geographic routing, parts inventory, procurement, or SLAs.
- Autonomous preemption or multiple active jobs per technician.
- Embeddings, RAG, vector databases, or a separate classification model.
- Redis, polling workers, Kafka, Kubernetes, or distributed workflow infrastructure.
- Production hosting, analytics, or a production-readiness claim.
- Independently enforced human approval.

## Further Notes

This spec synthesizes the supplied conversation, accepted decisions through Q98, domain glossary, and architecture records.
It is a design artifact, not evidence of implementation or successful tests.

The original objective remains a small, inspectable proof of concept with a short demo.
The chosen durable queue and concurrency requirements exceed the original two-tool incident-reporting concept.
The three-hour goal is an aspiration, not a verified delivery estimate.

Verify current Effect and ElevenLabs capabilities against official documentation before implementation.
No release date or supported API claim from the pasted conversation is treated as verified here.
Pin the versions used and record commands that reproduce actual test results.

Lead the README with the demo and the voice-to-work-order claim.
Explain deterministic operational control, confirmation limitations, queue behavior, and test evidence.
Keep the final video at or below 45 seconds.
Do not claim conversational tests passed until an actual run provides those results.

Apply the ready-for-agent label when the confirmed spec is published.
GitHub is the configured tracker, and the five default triage labels are accepted.
The target repository is samanyudas/voiceops, with private visibility.
