# VoiceOps review rules

Check the actual diff, other callers, and verification evidence.
Read AGENTS.md and the relevant ADRs before a finding.
Prioritize incorrect dispatch, duplicate mutation, lost queue work, missing transaction rollback, and unsafe workflow permissions.
Reject claims that maintenance checks prove an unimplemented voice or database path.
Check that privileged workflows execute trusted code and validate untrusted event data.
Check release ancestry before reporter confirmation and human replies before automatic closure.
Give a concrete failure scenario for each finding.
