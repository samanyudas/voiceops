# Keep operational decisions outside the voice model

The accepted design lets the voice model extract observations and request clarification while deterministic policy determines priority and dispatch eligibility.
Policy functions remain independent of persistence and Effect services so reviewers can inspect and test the operational rules directly.
This limits model authority, but the rules still depend on the accuracy and completeness of extracted observations.
