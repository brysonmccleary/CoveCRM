# CoveCRM Realtime 2.1 Mini + natural delivery — local review

Status: local implementation complete; owner review required before deployment or calls.
Date: 2026-09-16. Baseline checkout: `8f2a39ed`.
NOT DEPLOYED. NOT PUSHED TO PRODUCTION. NOT ENABLED FOR CUSTOMERS.
No commit, environment change, production data mutation, or phone call was performed.

## Identity and compatibility

- Kayla: `marin`, from the active context endpoint's iris/kayla/elena mappings.
- Jacob: `cedar`; default and legacy persona mappings are unchanged.
- Missing voice metadata still uses the voice server's existing `alloy` fallback.
- Default model: `process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-mini"`.
- Internal test model: exactly `gpt-realtime-2.1-mini`, with session `reasoning: { effort: "low" }`.
- Model choice does not select or override the voice.
- Existing raw WebSocket GA interface is retained; no new SDK/dependency, transcription provider, or STT→LLM→TTS pipeline.

Official compatibility/pricing sources checked using the OpenAI Docs skill:
[model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini),
[Realtime guide](https://developers.openai.com/api/docs/guides/realtime),
[session.update schema](https://developers.openai.com/api/reference/resources/realtime/client-events).
The documentation supports this model and reasoning configuration. Local tests validate the wire payload, not this account's entitlement or a live provider session.
The test path closes on setup rejection or mismatched model/reasoning/voice confirmation; it never silently substitutes a different experiment.

## Isolated selection and rollback

No new environment values were written or enabled. The following are code-supported switches for a separately authorized future test:

| Switch | Effect |
| --- | --- |
| `VOICE_REALTIME_21_MINI_TEST_V1` | Selects the exact test model with low reasoning |
| `VOICE_NATURAL_CONVERSATION_TEST_V1` | Enables natural-objective delivery and narrow pause/uncertainty/correction handling |
| `VOICE_PHASE1_TEST_EMAILS` | Existing comma-separated internal-account cohort, normalized for exact email matching |

Each new switch requires both its own enabled value and the verified context account's exact cohort match. Missing/unlisted accounts receive neither experiment. No global enable path exists. The switches are independent of one another and of all existing Phase 1 flags.
The natural insurance experiment deliberately leaves the separate `kayla_signup` CoveCRM demo, inbound greeting, and transfer-rebooking greeting workflows alone.

Rollback: disable either new switch to restore that component on new sessions; disable both for the current model/controller path. Keep the existing default model override and Phase 1 settings unchanged. Deployment environment changes may require the normal service restart; already-running calls retain their per-call selection until they end. There is no automatic customer rollout.

## Implementation and script fidelity

The existing classifier, policy router, script inventory, state writes, qualification gates, objection counters, booking triggers, transfer logic and final-outcome handling remain authoritative.

The experiment adds a delivery wrapper around policy-selected content, flexible sales greeting and fallback instructions, and a stable concise personality. It removes blanket verbatim requirements for ordinary turns in the experimental system prompt. Existing ARC objection content and its pending reclose are retained, while the experimental ARC no longer suggests inventing an online-form source.

| Level | Use | Freedom |
| --- | --- | --- |
| 1 | Disclosures, consent/opt-out, protected appointment/transfer confirmations; explicit level-1 caller in code | Required line exactly; no additions |
| 2 | Ordinary script asks, day/time choices, approved answers/recloses | Natural phrasing; preserve facts, names, choices, times/timezones, question intent and approved answer substance |
| 3 | Greetings and brief reactions | Contextual phrasing within the same objective; no added sales step |

Numeric time choices alone no longer force an entire ordinary question to be read verbatim; their values remain immutable. Protected wording wins over a request for freer delivery. Per-turn forbidden topics are retained. The model cannot decide to advance stages, book, transfer, or change outcomes.

Personality: warm, concise, casually professional; optional appropriate acknowledgment rather than a canned phrase every turn. No artificial filler, fake laughter/stutters, rambling or manufactured consent.
Pure fillers/“hold on”/“No, no, hold on” retain the pending question without a paid response. Narrow uncertain answers such as “yeah...well maybe” clarify instead of committing an answer. Recognized corrections route using the final intended segment; opt-out/rejection cues are not discarded with a prefix. This is bounded deterministic handling, not a claim of universal speech understanding.

CRM context, notes, existing memory, Phase 1 prefetch/answer gating, adaptive pacing and the durable full transcript ledger remain in place.

## Restrictions

Shared and per-turn prompts retain English, names, product scope and assistant-role boundaries. Natural wording does not authorize underwriting or discovery: no soliciting age/DOB/SSN/banking, health/medical history/medications, income/budget, mortgage balance or coverage amounts. Volunteered data is not permission for follow-up interviewing.
No invented eligibility, prices/premiums, policy terms, approvals, guarantees, carriers, lead source or affiliations. Use supplied approved facts, or defer details to the licensed agent and return to the pending ask.
Existing opt-out and Not Interested decisions/counters remain unchanged.

Tests verify controller state, hard-stop routing, non-advancement of unanswered coverage qualification, preserved disclosure wording and prompt boundaries. They do NOT prove that a generative model can never violate an instruction; generated-answer and acoustic evaluation remain future test work.

## Frozen audio and dead air

Unchanged: bidirectional Twilio Media Streams, PCMU/μ-law, 8 kHz, 160-byte frames at 20 ms, transcription model, and server VAD:
- threshold `0.55`
- silence duration `400 ms`
- prefix padding `300 ms`
- `create_response: false`
- no semantic VAD

The actual inbound forwarding function is identical apart from replacing a misleading hard-coded dollar log with a duration-only label. Its local silence detector is unchanged. Idle frames outside an active/trailing speech window are dropped before `input_audio_buffer.append`.
Forwarding remains bounded: recent local speech 900 ms, OpenAI speech-start window 3500 ms, trailing speech 1200 ms, plus the pre-existing finite listen warmups. The test model switch does not bypass any gate. Offline tests send 3,000 idle PCMU frames (60 seconds of frame content) and observe zero appends; speech appends and expired warmup/speech tails are tested separately.

Interruption repair is intentionally deferred: the existing 800 ms accumulation cap remains below the 1200 ms cancellation threshold. Coordinated Twilio clear/mark and OpenAI conversation truncation are still absent. Fixing the threshold alone would not safely solve playback synchronization. This task did not change the audio path to mask that defect.

## Telemetry and costs

Added requested versus provider-confirmed model/voice, reasoning effort, effective controller mode, experiment flags and session-configuration errors. Existing response timing, speech duration, interruption counts, raw response usage, transcription usage and transcripts are retained.

A separately labeled Realtime token-cost estimate uses reported text/audio input/output and cached text/audio components. Published USD/million rates for the test model, checked 2026-09-16:
text input 0.60, cached text 0.06, text output 2.40; audio input 10, cached audio 0.30, audio output 20.
Cached input is subtracted from uncached input, not charged twice. Missing/inconsistent breakdowns or unpriced models yield null, not a fabricated zero or a partial “total.”
Realtime cost per connected minute is derived from that token estimate and actual connected duration.
This estimate excludes input transcription and Twilio. Their separate measured prices are not available in the current infrastructure; raw transcription usage is preserved. The old configured combined provider-per-minute estimate remains, explicitly labeled as a configured estimate rather than measured cost. No billing logic or schema was changed.

## Verification

Final local results:
- Focused upgrade and Phase 1 coverage is included in the complete relevant voice/session run.
- `npx jest __tests__/ai-voice.sim.test.ts __tests__/ai-session.sim.test.ts __tests__/ai-voice-phase1.test.ts __tests__/ai-voice-natural-upgrade.test.ts --runInBand`: 4 suites / 259 tests passed.
- `npx tsc --noEmit --incremental false`: passed.
- Voice-server `npm run build`: passed.
- `git diff --check`: passed.
- No deployment build, live provider call, phone call or customer traffic used.

The new harness executes the real server/controller inside an isolated VM, with env loading, network, sockets, listeners and timers replaced by offline doubles. Cases include greetings, forgotten requests, scam concern, busy/coverage objections, opt-out, volunteered medical facts, correction, pause, uncertain agreement, booking/transfer policy parity, protected confirmations, cohort isolation, voice/model payloads, provider rejection, silence gates and cached token accounting.
The existing ts-jest isolatedModules deprecation warning remains. Initial Jest discovery also reported the pre-existing duplicate socket-service package name. Neither prevented the relevant suites passing.

## Files changed by this task

1. `ai-voice-server/index.ts`
2. `ai-voice-server/lib/voiceExperiment.ts` (new)
3. `ai-voice-server/lib/realtimeUsage.ts` (new)
4. `ai-voice-server/lib/voiceTelemetry.ts`
5. `__tests__/ai-voice-natural-upgrade.test.ts` (new)
6. `docs/voice-realtime21-natural-local.md` (this report)

No context endpoint, worker, database schema, billing, SMS, campaigns or unrelated CRM code was edited.
Task-specific caffeinate session was stopped at the verification checkpoint (exit 130).

## Pre-existing workspace changes

The checkout had 199 status entries before editing. These include Meta/Facebook ads, recruiting, drips/SMS, calendar/appointment work, their tests, and `package.json`. They were not reverted, cleaned up, staged or committed. Directory entries below may contain multiple files.

<details>
<summary>Read-only starting status manifest</summary>

```text
 M __tests__/ad-wizard-spanish-lanes.test.ts
 M __tests__/drip-minute-delays.test.ts
 M __tests__/meta-audience-targeting.test.ts
 M __tests__/meta-capi.test.ts
 M __tests__/meta-generate-ad-combinations.test.ts
 M __tests__/meta-lead-form-template.test.ts
 M __tests__/meta-publish-reuse.test.ts
 M __tests__/meta-webhook-idempotency.test.ts
 M __tests__/recruiting-cloud-lifecycle.test.ts
 M __tests__/recruiting-companion-security.test.ts
 M __tests__/recruiting-launch-readiness.test.ts
 M components/AssignDripModal.tsx
 M components/DripCampaignsPanel.tsx
 M components/FacebookAds/AdPreviewCard.tsx
 M components/FacebookAds/AdWizard.tsx
 M lib/ai/campaignScriptKey.ts
 M lib/ai/handleAIResponse.ts
 M lib/calendar/scheduleAppointment.ts
 M lib/drips/computeScheduledDripSendAt.ts
 M lib/drips/createScheduledDripMessages.ts
 M lib/drips/enrollOnNewLead.ts
 M lib/drips/enrollOnNewLeadIfWatched.ts
 M lib/facebook/audienceTargeting.ts
 M lib/facebook/buildCampaignStructure.ts
 M lib/facebook/claimsRegistry.ts
 M lib/facebook/creativeCandidateSelection.ts
 M lib/facebook/creativeIntelligence/capabilities.ts
 M lib/facebook/creativeUsage.ts
 M lib/facebook/guardrails.ts
 M lib/facebook/hostedConsent.ts
 M lib/facebook/launchFingerprint.ts
 M lib/facebook/metaAdsetVerification.ts
 M lib/facebook/metaLeadFormTemplate.ts
 M lib/facebook/metaReconciliation.ts
 M lib/facebook/optimizationAlerts.ts
 M lib/facebook/publicMetaErrors.ts
 M lib/facebook/trackCRMOutcome.ts
 M lib/leads/structuredLeadFields.ts
 M lib/meta/capi.ts
 M lib/meta/processMetaLead.ts
 M lib/meta/retrieveLead.ts
 M lib/meta/syncAdInsights.ts
 M lib/mongo/leads.ts
 M lib/recruiting/access.ts
 M lib/recruiting/admin.ts
 M lib/recruiting/cloud/README.md
 M lib/recruiting/cloud/automation.ts
 M lib/recruiting/cloud/browserbase.ts
 M lib/recruiting/cloud/discovery.ts
 M lib/recruiting/cloud/lifecycle.ts
 M lib/recruiting/cloud/simulation.ts
 M lib/recruiting/cloud/worker.ts
 M lib/recruiting/qualification.ts
 M lib/recruiting/social/policy.ts
 M lib/recruiting/social/us-location.ts
 M lib/twilio/reconcileUserNumbers.ts
 M lib/twilio/resolvePreferredSmsDefault.ts
 M lib/twilio/sendSMS.ts
 M lib/twilioClient.ts
 M models/AdMetricsDaily.ts
 M models/DripEnrollment.ts
 M models/FBLeadCampaign.ts
 M models/FBLeadEntry.ts
 M models/FunnelSubmission.ts
 M models/Message.ts
 M models/MetaAdMetricsDaily.ts
 M models/MetaCAPIEvent.ts
 M models/MetaLeadFormTemplate.ts
 M models/MetaLeadWebhookEvent.ts
 M models/RecruitingAuditEvent.ts
 M models/RecruitingCampaign.ts
 M models/RecruitingCloudAccount.ts
 M models/RecruitingCompanionJob.ts
 M models/RecruitingDiscoveryJob.ts
 M models/RecruitingProspect.ts
 M models/RecruitingSocialAction.ts
 M models/ScheduledDripMessage.ts
 M models/SmsConsentEvidence.ts
 M package.json
 M pages/api/ai/appointments.ts
 M pages/api/assign-drip-to-folder.ts
 M pages/api/calendar/book-appointment.ts
 M pages/api/cron/process-meta-capi.ts
 M pages/api/cron/retry-meta-leads.ts
 M pages/api/cron/send-drip-messages.ts
 M pages/api/cron/sync-google-sheets.ts
 M pages/api/drips/drips-folder-watch.ts
 M pages/api/drips/enroll-folder.ts
 M pages/api/drips/enroll-lead.ts
 M pages/api/facebook/analyze-ad.ts
 M pages/api/facebook/auto-optimize.ts
 M pages/api/facebook/campaigns/[id].ts
 M pages/api/facebook/campaigns/[id]/reconciliation.ts
 M pages/api/facebook/funnel-submit.ts
 M pages/api/facebook/generate-ad.ts
 M pages/api/facebook/publish-ad.ts
 M pages/api/facebook/validate-launch.ts
 M pages/api/google/calendar/book-appointment.ts
 M pages/api/meta/status.ts
 M pages/api/meta/webhook.ts
 M pages/api/recruiting/accounts/connect.ts
 M pages/api/recruiting/accounts/index.ts
 M pages/api/recruiting/accounts/verify.ts
 M pages/api/recruiting/campaign-control.ts
 M pages/api/recruiting/campaigns.ts
 M pages/api/recruiting/capabilities.ts
 M pages/api/recruiting/companion/authorize.ts
 M pages/api/recruiting/companion/claim.ts
 M pages/api/recruiting/companion/complete.ts
 M pages/api/recruiting/companion/pair.ts
 M pages/api/recruiting/companion/pairing.ts
 M pages/api/recruiting/companion/queue.ts
 M pages/api/recruiting/companion/session-status.ts
 M pages/api/recruiting/discovery/claim.ts
 M pages/api/recruiting/discovery/complete.ts
 M pages/api/recruiting/insights.ts
 M pages/api/recruiting/launch.ts
 M pages/api/recruiting/overview.ts
 M pages/api/recruiting/simulate.ts
 M pages/api/recruiting/update-campaign.ts
 M pages/api/twilio/status-callback.ts
 M pages/drip-campaigns/index.tsx
 M pages/f/[id].tsx
 M pages/facebook-leads/index.tsx
 M pages/lead/[id].tsx
 M pages/recruiting/index.tsx
 M pages/recruiting/insights.tsx
?? __tests__/blocker-isolated/
?? __tests__/drip-v2-primary-sms.test.ts
?? __tests__/fixtures/
?? __tests__/meta-launch-authority.test.ts
?? __tests__/meta-retrieve-lead.test.ts
?? __tests__/meta-veteran-instant-form.test.ts
?? __tests__/meta-webhook-persistence.test.ts
?? __tests__/recruiting-browser-actions.test.ts
?? __tests__/recruiting-draft.test.ts
?? __tests__/recruiting-evidence-personalization.test.ts
?? __tests__/recruiting-execution-hardening.test.ts
?? __tests__/recruiting-pilot-cycle.test.ts
?? __tests__/recruiting-pilot-readiness.test.ts
?? __tests__/recruiting-pipeline-integration.test.ts
?? __tests__/recruiting-zero-spend.test.ts
?? __tests__/targeting-isolated/
?? __tests__/veteran-isolated/
?? artifacts/
?? components/FacebookAds/DeliveryReport.tsx
?? components/FacebookAds/TargetingControls.tsx
?? components/FacebookAds/TargetingEditor.tsx
?? components/Recruiting/
?? lib/drips/enrollLeadInDripV2.ts
?? lib/drips/formatFolderAssignmentSummary.ts
?? lib/facebook/acquisitionCohort.ts
?? lib/facebook/existingAudiences.ts
?? lib/facebook/leadQualification.ts
?? lib/facebook/nativeLeadFormQuestions.ts
?? lib/facebook/statusReadback.ts
?? lib/facebook/targetingControls.ts
?? lib/facebook/truckerOwnerReview/
?? lib/facebook/updateCampaignStates.ts
?? lib/facebook/veteranPerformancePolicy.ts
?? lib/meta/capiDelivery.ts
?? lib/meta/nativeConsent.ts
?? lib/meta/nativeLeadRouting.ts
?? lib/meta/nativeLeadStages.ts
?? lib/meta/readGraphCollection.ts
?? lib/recruiting/audience-presets.ts
?? lib/recruiting/audience.ts
?? lib/recruiting/campaign-settings.ts
?? lib/recruiting/cloud/PILOT_READINESS.md
?? lib/recruiting/cloud/browser-actions.ts
?? lib/recruiting/cloud/diagnostics.ts
?? lib/recruiting/cloud/execution-mode.ts
?? lib/recruiting/cloud/execution-policy.ts
?? lib/recruiting/cloud/leases.ts
?? lib/recruiting/cloud/migrate.ts
?? lib/recruiting/cloud/pilot-evaluate.ts
?? lib/recruiting/cloud/pilot-persistence-check.ts
?? lib/recruiting/cloud/pilot-simulation.ts
?? lib/recruiting/cloud/pilot-source-manifest.json
?? lib/recruiting/cloud/readiness.ts
?? lib/recruiting/cloud/replies.ts
?? lib/recruiting/cloud/usage.ts
?? lib/recruiting/cloud/zero-spend-test-guard.cjs
?? lib/recruiting/evidence.ts
?? lib/recruiting/personalization.ts
?? lib/recruiting/presentation.ts
?? lib/recruiting/social/profile-url.ts
?? lib/twilio/outboundSmsPolicy.ts
?? models/RecruitingActionReservation.ts
?? pages/api/facebook/campaigns/[id]/delivery-report.ts
?? pages/api/facebook/existing-audiences.ts
?? pages/api/recruiting/diagnostics.ts
?? pages/api/recruiting/draft.ts
?? pages/api/recruiting/pilot-cycle.ts
?? pages/api/recruiting/preview.ts
?? scripts/buildTruckerMassScaleReview.ts
?? scripts/buildTruckerOwnerReview.ts
?? scripts/migrate-drip-v1-to-v2.ts
?? scripts/verify-primary-sms-resolver.ts
```

</details>

## Next safe owner-authorized phone comparison

Stop for owner review now. A later test requires explicit approval of the reviewed deployment, intended service/revision, one internal account/email, owner-controlled consenting destination number and any required test configuration. First verify provider access to the exact model and low reasoning without substituting a different model.
Keep global Phase 1/customer settings unchanged. Baseline both new switches off; then isolate model-only, natural-only and combined calls if authorized, keeping script, Kayla marin voice, lead facts and Phase 1 settings constant. Jacob cedar can be checked in a separately authorized voice-preservation call.
Compare transcripts/required objectives, corrections/uncertainty, opt-out/disclosure fidelity, booking/transfer safety, caller-end-to-playable-audio latency, idle append counts, token/cache usage and costs. Listen for PSTN tone and naturalness; do not treat local tests as acoustic proof. The known interruption defect must be disclosed in the comparison.
Turn the experimental switches off after the approved test. No further action is authorized by this local implementation request.

