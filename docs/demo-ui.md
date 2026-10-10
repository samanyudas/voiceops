# Run the demo page

The demo page shows one maintenance report moving through the real backend.
It has six steps: Call, Understand, Decide, Confirm, Dispatch, and Resolve.
Every card is rendered from an actual backend response.
The page never shows canned results.

## Start the page

Start Postgres, seed the data, and run the backend as described in [the backend guide](backend.md).
Then build and start the demo server in a second terminal.

```sh
npm run build
npm run demo
```

Open `http://127.0.0.1:4173`.
The demo server reads `TOOL_API_KEY`, `TECHNICIAN_API_KEY`, and `VOICEOPS_URL` from `.env`.
It holds both credentials, so the browser never receives them.
It listens only on `127.0.0.1`.
Set `DEMO_PORT` to change the port.

## Play scenario

Play sends the real API calls for a typed report about pump P-101.
The operator's words are typed, not spoken, and the page labels the voice as simulated.
On freshly seeded data, the report creates a HIGH priority job.
It raises a duplicate question about the seeded P-101 job and then waits in the queue.
The page then resolves Tech-03's seeded job, and the queue assigns the new job to Tech-03.
Finally Tech-03 acknowledges, starts, resolves, and closes the new job.

A repeated run uses the current database state.
After the first run, a mechanic is free, so later runs are assigned immediately.
The seed command never resets operational state, and events are append-only.
To see the queued path again, recreate the database and seed it.

## Live voice

Live voice streams microphone audio to the hosted ElevenLabs agent.
Add these values to `.env` before you start the demo server.

```text
ELEVENLABS_API_KEY=<your ElevenLabs API key>
ELEVENLABS_AGENT_ID=<the provisioned agent identifier>
DEMO_TOOL_RELAY_PORT=3001
```

The demo server requests a short-lived signed conversation URL, so the browser never receives the API key.
The tool relay port forwards only the operator routes to the backend.
It passes the agent's own operator credential through and never adds a credential.
Point the HTTPS tunnel at the relay port instead of the backend port.
The page then lights each step when the agent's tool call reaches the backend.
After confirmation, the page runs the technician steps with real technician requests.

The browser allows microphone access only on `localhost` or HTTPS.
Each live call uses ElevenLabs credits.
The agent must use PCM audio formats.

## Technical details

"Show technical details" lists every recorded backend call.
Each entry shows its method, path, status, latency, source, request, and response.
The source is either the demo page or the voice agent.
The list never contains credential headers.
Polling of `GET /state` is not recorded.
