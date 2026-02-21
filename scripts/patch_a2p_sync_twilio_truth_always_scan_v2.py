import pathlib, sys

path = pathlib.Path("pages/api/a2p/sync.ts")
s = path.read_text()
orig = s

start_marker = "      // ✅ Twilio = truth: if DB is missing/wrong SIDs, reattach to canonical Twilio campaign.\n"
end_marker = "      } catch {\n        // non-fatal; we'll fall back to existing behavior\n      }\n"

start = s.find(start_marker)
if start == -1:
    print("ERROR: start marker not found. Aborting.")
    sys.exit(1)

end = s.find(end_marker, start)
if end == -1:
    print("ERROR: end marker not found after start. Aborting.")
    sys.exit(1)

# Include the end_marker itself in the replaced span
end = end + len(end_marker)

replacement = """      // ✅ Twilio = truth (bulletproof):
      // Always consider canonical campaign from Twilio (approved > pending > newest),
      // even if our stored campaign fetch succeeds, because resubmits can create new SIDs.
      try {
        // Fetch current (if present) to get a status baseline
        let currentStatus: string | undefined;
        const fetched = await tryFetchCampaignTenant({ client, messagingServiceSid, campaignSid });
        if (fetched) {
          currentStatus = (fetched as any)?.status || (fetched as any)?.state;
          campStatus = currentStatus || campStatus;
        }

        const canonical = await scanTwilioForCanonicalCampaignTenant({
          client,
          preferBrandSid: brandSid || null,
        });

        const scoreCurrent = scoreCampaignStatus(currentStatus || campStatus || "");
        const scoreCanonical = scoreCampaignStatus(canonical?.campaignStatus || "");
        const currentApproved = Boolean(
          String(currentStatus || campStatus || "").toLowerCase() &&
            CAMPAIGN_APPROVED.has(String(currentStatus || campStatus || "").toLowerCase())
        );

        const shouldSwitch =
          (!campaignSid || !messagingServiceSid) ||
          (canonical?.campaignSid && canonical?.messagingServiceSid && scoreCanonical > scoreCurrent) ||
          (canonical?.campaignSid &&
            canonical?.messagingServiceSid &&
            canonical.campaignSid !== campaignSid &&
            !currentApproved);

        if (shouldSwitch && canonical?.messagingServiceSid && canonical?.campaignSid) {
          messagingServiceSid = canonical.messagingServiceSid;
          campaignSid = canonical.campaignSid;
          if (canonical.brandSid && String(canonical.brandSid).startsWith("BN")) {
            brandSid = String(canonical.brandSid);
          }

          // Persist canonical SIDs so future syncs are accurate
          await A2PProfile.updateOne(
            { _id: doc._id },
            {
              $set: {
                messagingServiceSid,
                campaignSid,
                usa2pSid: campaignSid,
                ...(brandSid ? { brandSid } : {}),
                lastSyncedAt: new Date(),
              },
              $unset: { lastError: 1 },
            }
          );

          if (canonical.campaignStatus) {
            campStatus = canonical.campaignStatus;
          }
        }
      } catch {
        // non-fatal; we'll fall back to existing behavior
      }
"""

s = s[:start] + replacement + s[end:]

if s == orig:
    print("ERROR: no changes made. Aborting.")
    sys.exit(1)

path.write_text(s)
print("OK: patched", path)
