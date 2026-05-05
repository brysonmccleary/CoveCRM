import { resumeA2PAutomationForUserEmail } from './lib/a2p/resumeAutomation'

async function run() {
  const result = await resumeA2PAutomationForUserEmail('aliciaandrade.ffl@gmail.com')
  console.log(JSON.stringify({
    profileSid: result?.profileSid,
    profileStatus: result?.profileStatus,
    trustProductSid: result?.trustProductSid,
    trustProductStatus: result?.trustProductStatus,
    brandSid: result?.brandSid,
    brandStatus: result?.brandStatus,
    campaignSid: result?.campaignSid,
    usa2pSid: result?.usa2pSid,
    campaignStatus: result?.campaignStatus,
    messagingServiceSid: result?.messagingServiceSid,
    messagingReady: result?.messagingReady,
    registrationStatus: result?.registrationStatus,
    applicationStatus: result?.applicationStatus,
    declinedReason: result?.declinedReason,
    lastError: result?.lastError,
  }, null, 2))
}

run().catch(console.error)
