# 05 Twilio Costs

Static audit only. No Twilio calls or pricing API calls were executed. Dollar values require the account's Twilio pricing, subaccount regions, carrier fees, and actual call logs. This section maps what the code can make Twilio bill.

## Findings

| rank | finding | evidence |
|---|---|---|
| P1 | AI live transfer creates a second outbound PSTN leg to the agent while keeping the lead in a conference, so overlap time is at least two PSTN legs plus conference/media-stream cost. | Agent leg is created at `pages/api/ai-calls/transfer-twiml.ts:137`; lead is placed into conference at `pages/api/ai-calls/transfer-twiml.ts:173`. |
| P1 | Mobile inbound mode creates a caller conference leg and a separate `client:{ownerEmail}` agent leg; ringing/hold time can keep the caller leg active with looping ringback. | Agent client call at `pages/api/twilio/voice/inbound.ts:455`; caller conference at `pages/api/twilio/voice/inbound.ts:479`; looping waitUrl at `pages/api/twiml/ringback.ts:13`. |
| P1 | Inbound non-mobile mode can keep the call in progress up to the client dial timeout while trying the agent. | `answerOnBridge` and `timeout: 25` at `pages/api/twilio/voice/inbound.ts:502`; client leg status callback at `pages/api/twilio/voice/inbound.ts:512`. |
| P2 | Mobile outbound calls are conference-based and record the PSTN leg; dashboard cost should include outbound PSTN minutes plus recording/storage/transcription chain. | Mobile outbound `client.calls.create` at `pages/api/twilio/voice/call-mobile.ts:212`; `record: true` at `pages/api/twilio/voice/call-mobile.ts:218`. |
| P2 | Manual conference start can create two outbound legs from one API call. | `pages/api/start-conference.ts:171` creates agent call; `pages/api/start-conference.ts:181` creates lead call. |

## Cost Model From Code

| flow | Twilio-billable surfaces visible in code |
|---|---|
| AI dialer normal call | One outbound call to lead, one bidirectional media stream to AI voice server, recording callback when configured by worker. Worker callback URLs at `pages/api/ai-calls/worker.ts:95` and `pages/api/ai-calls/worker.ts:101`; AI stream handled by `ai-voice-server/index.ts:10882`. |
| AI live transfer | Lead call continues into `<Conference>` and separate agent PSTN leg is created. During overlap: lead PSTN minutes + agent PSTN minutes + conference/media stream until stream stops. Evidence: `pages/api/ai-calls/transfer-twiml.ts:137`, `pages/api/ai-calls/transfer-twiml.ts:173`. |
| AI transfer failure/reboot | If agent leg fails, transfer TwiML redirects/reboots lead into AI stream. Evidence: reboot on transfer create failure at `pages/api/ai-calls/transfer-twiml.ts:154`; fallback reboot at `pages/api/ai-calls/transfer-fallback.ts:315`. |
| Mobile inbound | Caller conference with ringback, plus agent `client:` call; may record from start. Evidence: `pages/api/twilio/voice/inbound.ts:455`, `pages/api/twilio/voice/inbound.ts:486`. |
| Mobile outbound | One PSTN leg from server to lead joined to a conference, recording enabled. Evidence: `pages/api/twilio/voice/call-mobile.ts:212`, `pages/api/twilio/voice/call-mobile.ts:218`. |
| Manual conference | Two Twilio calls are created: agent and lead. Evidence: `pages/api/start-conference.ts:171`, `pages/api/start-conference.ts:181`. |

## What To Compare In Twilio Dashboard

| check | why |
|---|---|
| Compare AI transfer calls by parent CallSid and conference name. | Confirms whether stream close occurs immediately after `ai-voice-server/index.ts:11270`. |
| Compare agent-leg duration vs lead-leg duration for transfers. | Expected overlap should be agent ring/answer time plus conference talk time. |
| Compare mobile inbound caller wait time to agent answer/miss time. | `pages/api/twiml/ringback.ts:13` loops indefinitely when used as waitUrl, bounded by the surrounding dial/conference behavior. |
| Compare recording/transcription charges against endpoints. | Recordings are stored via `/api/voice/recording-webhook` and transcriptions can be auto-triggered from `pages/api/twilio/voice-status.ts:565`. |

