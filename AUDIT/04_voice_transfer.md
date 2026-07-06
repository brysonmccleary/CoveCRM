# 04 Voice Transfer

Static audit only. No calls, sockets, servers, DB reads, Stripe calls, Twilio calls, or OpenAI calls were executed.

## Findings

| rank | finding | evidence |
|---|---|---|
| P1 | Live transfer successful path closes the OpenAI socket, but billing is tied to Twilio stream stop/close rather than the redirect moment. In normal Twilio behavior the redirect should end the media stream, but production should verify no delayed close tail is being metered. | `ai-voice-server/index.ts:11258` sets `transferInProgress` before redirect; `ai-voice-server/index.ts:11268` marks phase ended; `ai-voice-server/index.ts:11270` closes OpenAI; billing runs on Twilio stop/close at `ai-voice-server/index.ts:11866` and `ai-voice-server/index.ts:10966`. |
| P1 | Transfer fallback can intentionally reboot AI after failed/no-answer transfer; this is expected behavior but creates a second OpenAI/Twilio media window if the agent leg fails. | `pages/api/ai-calls/transfer-fallback.ts:79` checks `transferRebootPending`; `pages/api/ai-calls/transfer-fallback.ts:93` returns a reboot stream; `pages/api/ai-calls/transfer-reboot-twiml.ts:41` creates a new `<Connect><Stream>`. |
| P1 | Transfer secrets are passed in query strings across TwiML/action URLs, increasing log/referrer exposure risk for the shared `AI_DIALER_CRON_KEY`. | `ai-voice-server/index.ts:11237` builds transfer URL; `pages/api/ai-calls/transfer-twiml.ts:72` checks `key`; `pages/api/ai-calls/transfer-twiml.ts:93` embeds the key into fallback URL; `pages/api/ai-calls/transfer-twiml.ts:111` embeds it into bridge/AMD URLs. |
| P2 | Transcript capture is in-memory Realtime transcription and endpoint-gated persistence; static pass did not find a direct `/api/ai-calls/transcript` POST from the voice server, so transcript completeness should be verified from production records. | Realtime transcription config at `ai-voice-server/index.ts:12007`; transcript events handled around `ai-voice-server/index.ts:12306`; transcript endpoint requires key/session/lead/user/duration at `pages/api/ai-calls/transcript.ts:190`. |

## Transfer Map

| component | role | evidence |
|---|---|---|
| `ai-voice-server/index.ts` | Owns live transfer initiation from active AI call. | `performLiveTransfer` starts at `ai-voice-server/index.ts:11077`; REST redirect target is Twilio Calls API at `ai-voice-server/index.ts:11255`. |
| `pages/api/ai-calls/transfer-twiml.ts` | Receives redirected lead leg, creates agent PSTN leg, and puts lead into conference. | Two-leg comment at `pages/api/ai-calls/transfer-twiml.ts:2`; agent leg `client.calls.create` at `pages/api/ai-calls/transfer-twiml.ts:137`; lead conference at `pages/api/ai-calls/transfer-twiml.ts:173`. |
| `pages/api/ai-calls/agent-bridge-twiml.ts` | Agent leg bridge target. | Listed as secret-header route in `AUDIT/REPO_MAP.md:101`; key is passed from `pages/api/ai-calls/transfer-twiml.ts:111`. |
| `pages/api/ai-calls/agent-amd-callback.ts` | Agent AMD/status callback for transfer outcome/reboot decisions. | Listed as secret-header route in `AUDIT/REPO_MAP.md:100`; status callback configured at `pages/api/ai-calls/transfer-twiml.ts:142`. |
| `pages/api/ai-calls/transfer-fallback.ts` | Twilio `<Dial action>` handler after conference/agent leg outcome. | Fallback action URL at `pages/api/ai-calls/transfer-twiml.ts:92`; successful transfer outcome write starts at `pages/api/ai-calls/transfer-fallback.ts:206`; no-answer booking fallback starts at `pages/api/ai-calls/transfer-fallback.ts:244`. |
| `pages/api/ai-calls/transfer-reboot-twiml.ts` | Reconnects lead to AI voice stream after failed transfer. | Key/AI WSS validation at `pages/api/ai-calls/transfer-reboot-twiml.ts:29`; stream construction at `pages/api/ai-calls/transfer-reboot-twiml.ts:41`. |

## OpenAI Socket Lifecycle

| lifecycle site | behavior | evidence |
|---|---|---|
| Twilio media stream connect | Initializes per-call state and waits for `start`. | `ai-voice-server/index.ts:10882`; state init at `ai-voice-server/index.ts:10885`. |
| OpenAI websocket open/config | Opens WSS to Realtime model and sends `session.update`. | WSS URL at `ai-voice-server/index.ts:11911`; `session.update` starts at `ai-voice-server/index.ts:11998`; model/audio/VAD at `ai-voice-server/index.ts:12001`. |
| Successful transfer | Marks call ended and closes OpenAI. | `ai-voice-server/index.ts:11268`; `ai-voice-server/index.ts:11270`. |
| Twilio stop | Closes OpenAI and bills. | `ai-voice-server/index.ts:11860`; `ai-voice-server/index.ts:11866`. |
| Twilio websocket close | Bills best-effort and closes OpenAI. | `ai-voice-server/index.ts:10966`; `ai-voice-server/index.ts:10984`. |
| OpenAI close | Does not terminate Twilio while transfer is in progress. | `ai-voice-server/index.ts:12091`. |

## Billing Meter Points

| meter point | evidence |
|---|---|
| AI voice call start time is set from Twilio `start`. | `ai-voice-server/index.ts:11294` sets `callStartedAtMs`. |
| AI session billing on Twilio `stop`. | `ai-voice-server/index.ts:11866`. |
| AI session billing on websocket `close`. | `ai-voice-server/index.ts:10966`. |
| Idempotent session-time billing lock is in `trackAiDialerSessionUsage`. | `lib/billing/trackAiDialerSessionUsage.ts:108`. |

