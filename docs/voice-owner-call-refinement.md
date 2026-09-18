# Owner-call refinement — local only

## Verification gate: passed before edits

Reviewed the latest owner call visible in [Render application logs](https://dashboard.render.com/web/srv-d4rl7g4hg0os73apupn0/logs): September 17, 2026, 6:10:08–6:12:37 PM MST, call `CA6f02ecf42c5e481f1015f6c62781bb1f`, session `6aac83fee79b972a6464eb58`. The owner account matches the intended single-account cohort.

- At 6:10:18, the actual connection URL selected **gpt-realtime-2.1-mini**; the connection succeeded at 6:10:19.
- The call's session update selected that model, marin, and PCMU input/output. `session.updated` and `PROMPT-APPLIED` followed, then the conversation proceeded. The deployed code rejects a provider acknowledgement that differs in model, low reasoning effort or voice on this experiment path; it did not take that rejection path.
- The call's prompt had both exact-script markers false, included the repaired conversation-plan instructions, and later used `conversation_question` routes. These are evidence that the owner-only natural-conversation path actually ran, not merely that a dashboard flag was configured.
- The older flags `contextPrefetchV1`, `adaptivePacingV1`, and `naturalScriptV1` were explicitly false. That is expected: the newer `realtime21MiniTest` and `naturalConversationTest` switches are separate. The old flag log does not print those newer booleans; their effective state is established by the gated model/prompt/routes above.
- The startup default `gpt-realtime-mini` is not the per-call selection. Neither model selection, low reasoning effort, allowlisting nor voices changed in this refinement.

## Thinking/strategy leakage

The owner's quoted speech is strategy narration, not proof of exposure of hidden model reasoning. The prompt mixed private workflow instructions with caller-facing speech and said “Speak only the supplied turn objective,” without an explicit spoken-output/preamble boundary. The model could describe carrying out the objective rather than simply perform it. At 6:10:37 the identity recovery route ran; at 6:10:54 the caller explicitly challenged the awkward “let me answer” wording, and the generic-question route ran. Application logs do not include a complete verbatim assistant audio transcript for those turns, so the exact spoken sentence comes from the owner's report.

The shared natural prompt now makes private control information explicitly non-spoken, forbids strategy/reasoning/preamble narration, and asks for only the direct answer plus any authorized next question. It also prevents narrating the restriction in response to a complaint. This is a general output contract, not a blacklist of that sentence. No audio filtering, transport changes or new model call was introduced.

OpenAI Docs informed this separation: the [Realtime prompting guide](https://developers.openai.com/api/docs/guides/voice-prompting) distinguishes spoken preambles from hidden reasoning and recommends skipping preambles for direct answers. Its general guidance is used here without changing the pinned model.

## Booking momentum

The exact logged receptive turn at 6:12:18 was “Okay, yeah, I guess we can do, well, how long does it take?” It routed to `conversation_question`, which previously required no question, forbade a reclose and exposed a yield action. That lost the affirmative part of the turn and made the response unnecessarily passive.

A bounded willingness signal now selects `answer_and_continue` for receptive turns with established coverage, unless refusal, time constraints, frustration, hearing/repetition, concrete validated scheduling, or terminal state requires another path. The response answers the question and asks the next missing scheduling choice. Duration answers use the existing approved 5–10 minute estimate, not a new promise. Existing selected-day context proceeds toward time rather than restarting the day question. Previous concern suppression is cleared when the caller re-engages.

Willingness is NOT a confirmed appointment or permission to transfer. Existing validation and action paths remain authoritative. Waiting now explicitly means stop speaking and listen, not manufacture an exit for an engaged caller.

## Semantic repetition and AI disclosure

At 6:11:31 and 6:11:44, broad partial confusion was classified as `policy_confused_identity`, forcing the identity/reason-for-calling frame again. The refinement intercepts this on the internal path: actual identity/purpose questions receive a short requested detail; general or incomplete confusion receives a targeted clarification instead of an introduction.

The conversation memory now retains established identity and call purpose from actual assistant transcript events, beyond the bounded recent-history window. These topics are included in structured context and are not repeated unless genuinely requested or unheard. Existing coverage memory and objective-repeat protection remain intact.

“You already said that” continues to select repetition repair with no repeated sales question. “Can you repeat that?” continues to permit repeating the last actually spoken content. Truthful AI/virtual-assistant disclosure is explicitly retained; claiming to be human is prohibited.

## Audio: diagnosis only

Observed evidence, not a confirmed static diagnosis:

- PCMU was configured in both directions; the outbound pusher logged 20 ms pacing.
- Before the greeting, the input buffer log reported 25 frames retained and 72 dropped. This is inbound startup buffering, not proof of lost outbound speech.
- `droppedIdleSilence2s` varied, reaching 100–101 frames in idle intervals and zero in many speech intervals. These are classified inbound silence drops, not evidence of outbound packet loss.
- Forced stuck-speech commits occurred at 6:11:31 and 6:12:17. Later normal speech-stopped/committed events followed at 6:11:34 and 6:12:20.
- Restored text at 6:11:44 contains concatenated fragments (`Youwill`, `Youwillget`, `Youwillgetit`); the receptive sentence reappears at 6:12:28 with an added “Take.” These support investigating input transcription/commit replay separately. They do not prove duplicated PCM frames or explain rough output audio.
- Observed outbound pacing ended with ordinary buffer-drained/OpenAI-done messages. Searches for error, duplicate and jitter yielded no matching log lines in the reviewed window. No sample-level integrity, outbound underrun, sequence-gap or measured-jitter record was available to establish or exclude those problems.

No VAD, PCMU/codec, sample rate, conversion, buffering, pacing, silence, barge-in, Twilio media or OpenAI audio handling was changed. The actual static/roughness cause remains **unconfirmed**.

## Separate Twilio/CRM end-call evidence — no fix

At 6:12:36 the voice server received Twilio media `stop`, closed OpenAI, and entered `ended`. At that close instant `finalOutcomeSent` was undefined; the subsequent outcome request returned HTTP 200 / `ok: true`, recording `disconnected` with `moved=false`. Usage reporting also returned 200. At 6:12:37 the final transcript save completed with reason `twilio_stop` and 22 turns, followed by WebSocket close.

This proves the voice server received the stream stop and its outcome endpoint accepted a request. It does NOT prove Twilio's separate status callback was authenticated, the CRM session's active call cleared, the worker advanced, or the UI refreshed. `finalOutcomeSent` before the successful asynchronous response alone is not proof of a bug. The previous deployment updated only the Render voice service, not the CRM host's callback endpoint; production deployment of the separate callback fix remains unverified here. Callback implementation and tests are byte-for-byte unchanged.

## Changes and verification

Changed only three existing source files:

- `ai-voice-server/lib/voiceExperiment.ts`: natural spoken-output boundary and non-passive waiting guidance; model/voice/flag logic untouched.
- `ai-voice-server/lib/conversationRepair.ts`: mixed-intent willingness evidence, identity/purpose distinctions, persistent spoken-topic memory, explicit answer-and-continue response plan.
- `ai-voice-server/index.ts`: owner-gated routing integration and spoken-topic recording; no media/action/callback changes.

Added `__tests__/ai-voice-refinement.test.ts` and this report. Before/after hashes confirm no unrelated existing file changed.

- Relevant regression selection: **454 tests passed in 24 suites**, including **18 new refinement tests**, the latest owner's sequential conversation, both main/replay momentum paths, and the existing callback/voice/dialer/billing/session tests.
- Root TypeScript (`--noEmit --incremental false`): passed.
- Voice-server production TypeScript build: passed.
- Normal root production build using unchanged existing environment files: passed, 76 static pages and build traces.
- Relevant lint including normally ignored server sources: zero errors, 29 existing-server warnings; no unrelated warning fixes.

No deployment, commit, push, merge, live provider call, environment edit, or customer call was performed. Existing repairs remain in place.

## Readiness

**READY locally for a controlled owner-only evaluation after separately authorized deployment. NOT READY to test this new refinement against the currently deployed revision**, which is unchanged by this task. Prompt/state regressions do not prove generated speech will never narrate strategy; that needs listening to actual owner-call audio. Unseen mixed language and the separate audio/end-call issues remain risks. No customer rollout approval is implied.
