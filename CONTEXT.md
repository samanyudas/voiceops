# VoiceOps maintenance intake

VoiceOps models maintenance reporting and technician allocation in a fictional facility.

## Language

**Asset**:
A piece of equipment identified in the facility's asset registry.

**Observation**:
A condition reported by an operator, rather than a verified diagnosis.
An unreported condition is unknown, not absent.

**Draft**:
A proposed maintenance request awaiting confirmation.
A draft does not reserve a technician.

**Work order**:
A confirmed maintenance request tracked through completion.
_Avoid_: Incident, ticket, task when referring to this record.

**Priority**:
The urgency of a work order under the synthetic maintenance policy.

**Required skill**:
The capability a technician needs to receive a work order.

**Assignment**:
The allocation of a work order to one technician.
A technician has at most one active assignment.

**Dispatch**:
The allocation of eligible work to an available technician within the simulation.
Dispatch does not contact a real person.

**Queue**:
Confirmed work awaiting a compatible, available technician, ordered by priority and then age.

**Possible duplicate**:
A report about the same asset and fault category as an unresolved work order.
The operator decides whether it describes the same issue or a new occurrence.

**Escalation**:
A recorded need for attention while a critical work order awaits assignment.
Assignment ends this capacity-related escalation, not the underlying hazard.

**Resolved**:
Field work is finished and the technician's capacity is released.

**Closed**:
The resolved work order has completed administrative review.

**Manual review**:
A hold on automatic dispatch because a maintenance request has unresolved classification or missing required facts.
This is the end of the automated flow for that request in the PoC.
