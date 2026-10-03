# Configure the VoiceOps hosted agent

Use these commands after the backend and public HTTPS tunnel work.
Offline preparation does not need an API key.
Provisioning creates cloud resources.
Live simulation tests can use paid ElevenLabs credits.

## Prepare without cloud requests

Run this command from the repository root.

```sh
VOICEOPS_PUBLIC_URL=https://voiceops.example.com \
ELEVENLABS_TOOL_SECRET_ID=offline_secret_locator \
node tools/elevenlabs.mjs prepare
```

The script writes three webhook tools, one agent, and five simulation tests to `artifacts/elevenlabs/prepared.json`.
The offline tool identifiers are placeholders.
Do not upload the prepared file directly.
Provisioning replaces those placeholders with created identifiers.

To check the current official request schemas, download the [ElevenLabs OpenAPI document](https://api.elevenlabs.io/openapi.json).
Save it in an ignored artifact directory.
Pass its path with `--openapi` during preparation.

```sh
VOICEOPS_PUBLIC_URL=https://voiceops.example.com \
ELEVENLABS_TOOL_SECRET_ID=offline_secret_locator \
node tools/elevenlabs.mjs prepare --openapi artifacts/elevenlabs-openapi.json
```

The validator checks request fields against the downloaded schemas.
It does not prove that an account accepts a model, resource, or secret.

## Configure credentials and a tunnel

Create a secret in the ElevenLabs workspace with the backend voice-tool credential as its value.
Copy the secret identifier, not its value, into the ignored `.env` file.
Use a public HTTPS origin for the tunnel.
The URL must have no path, credentials, query, or nonstandard port.
The script rejects IP addresses and local hostnames.
It does not perform DNS verification.
Verify that the tunnel reaches only the intended backend.

Set these values in `.env`.
Keep credential values out of chat, logs, and Git.

```text
ELEVENLABS_API_KEY=<your ElevenLabs API key>
ELEVENLABS_TOOL_SECRET_ID=<the ElevenLabs secret identifier>
VOICEOPS_PUBLIC_URL=https://<your tunnel hostname>
```

The workspace secret must match the backend `VOICEOPS_TOOL_KEY` value.
The agent uses `x-voiceops-tool-key` with an ElevenLabs `secret_id` locator.
Do not expose the separate technician credential to the agent.
Use an API key that can create tools, agents, tests, and test invocations.
The required permissions depend on the account configuration.

## Provision and resume

Run this command only when you intend to create cloud resources.

```sh
node --env-file=.env tools/elevenlabs.mjs provision --live
```

The script saves created identifiers in ignored `artifacts/elevenlabs/state.json`.
It saves a pending intent before each creation request.
A repeated command skips resources with saved identifiers.
A changed configuration stops provisioning before further writes.
The script does not update or delete existing cloud resources.

If a creation request loses its response, the script refuses an automatic retry.
Inspect the ElevenLabs workspace for that pending resource.
Verify its name and configuration before adopting its identifier.

```sh
node --env-file=.env tools/elevenlabs.mjs adopt --live \
  --resource get_maintenance_context --id <remote-tool-id>
node --env-file=.env tools/elevenlabs.mjs provision --live
```

The adoption command reads the resource and checks its name and configured fields.
The operator must check its configuration in ElevenLabs before adoption.
Use `agent` for the agent resource.
Use a scenario key for a test resource.
Never clear pending state and repeat creation when the original outcome remains unknown.
If the request definitely created nothing, preserve the state file and repair that pending entry before another attempt.

The script uses an exclusive `state.lock` file during cloud operations.
If the process crashes, verify that no operation still runs before removing the stale lock.
Do not run provisioning in two checkouts against the same intended cloud deployment.
A checkpoint protects one local state file, not independent copies of that file.

## Run the five conversational scenarios

Run this command only when you intend to spend test credits.

```sh
node --env-file=.env tools/elevenlabs.mjs run-tests --live
```

The scenarios cover complete intake, missing asset identifier, unknown asset, explicit emergency conditions, and ambiguous facts.
Every scenario mocks all tools.
An unmatched mock returns an error instead of calling the backend.
The backend receives no test mutation from these simulations.
Success criteria check clarification, uncertainty, backend assessment, verbal confirmation, and accurate outcome descriptions.

The script saves the invocation identifier before polling.
It accepts a passing result only when exactly five expected tests report passed.
Resume an unfinished invocation without another paid start.

```sh
node --env-file=.env tools/elevenlabs.mjs run-tests --live --resume
```

If the start request loses its response before the identifier is saved, inspect ElevenLabs before another run.
Recover the original invocation identifier in the state file, then resume polling.
Do not start another paid invocation while the original outcome remains unknown.
The script stores only result counts, not conversation transcripts or response error bodies.
Use the ElevenLabs dashboard to inspect failed criteria and transcripts.

These simulations evaluate agent behavior against deterministic mocked tool responses.
They do not prove actual webhook execution, Postgres persistence, dispatch concurrency, or audio quality.
Record the invocation identifier and result counts only after a real run.
No live simulation result is claimed by this setup.

## Record a voice demonstration

Open the created hosted agent in ElevenLabs.
Use actual synthetic backend data through the verified HTTPS tunnel.
Show the returned work order and persisted assignment in the terminal.
Use the separate technician CLI to demonstrate capacity release and queued assignment.
Keep the recording at or below 45 seconds.

The prompt requests verbal confirmation before a mutation.
That confirmation remains model-mediated.
Separate preparation and confirmation do not independently enforce human consent.
The backend owns priority, duplicate decisions, eligibility, technician allocation, and lifecycle constraints.

## Official references

- [Webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools) describe HTTP schemas and secret headers.
- [Create a tool](https://elevenlabs.io/docs/api-reference/tools/create) documents tool resource creation.
- [Create an agent](https://elevenlabs.io/docs/api-reference/agents/create) documents hosted agent creation.
- [Agent testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing) explains agent test scenarios.
- [The OpenAPI document](https://api.elevenlabs.io/openapi.json) defines the request and response schemas used by these commands.
