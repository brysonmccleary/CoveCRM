import mongoose from 'mongoose'
import User from './models/User'
import A2PProfile from './models/A2PProfile'

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || '')

  const email = 'aliciaandrade.ffl@gmail.com'

  const user = await User.findOne({ email }).lean()

  console.log('\nUSER:', user && {
    _id: String(user._id),
    email: user.email,
    a2p: user.a2p,
    numbers: user.numbers,
  })

  const a2p = user
    ? await A2PProfile.findOne({ userId: String(user._id) }).lean()
    : null

  console.log('\nA2P PROFILE:', a2p && {
    _id: String(a2p._id),
    profileSid: a2p.profileSid,
    profileStatus: a2p.profileStatus,
    trustProductSid: a2p.trustProductSid,
    trustProductStatus: a2p.trustProductStatus,
    brandSid: a2p.brandSid,
    brandStatus: a2p.brandStatus,
    campaignSid: a2p.campaignSid,
    usa2pSid: a2p.usa2pSid,
    campaignStatus: a2p.campaignStatus,
    messagingServiceSid: a2p.messagingServiceSid,
    messagingReady: a2p.messagingReady,
    registrationStatus: a2p.registrationStatus,
    applicationStatus: a2p.applicationStatus,
    declinedReason: a2p.declinedReason,
  })

  await mongoose.disconnect()
}

run().catch(console.error)
