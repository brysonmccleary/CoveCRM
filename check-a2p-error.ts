import mongoose from 'mongoose'
import User from './models/User'
import A2PProfile from './models/A2PProfile'

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || '')
  const user = await User.findOne({ email: 'aliciaandrade.ffl@gmail.com' }).lean()
  const a2p = user ? await A2PProfile.findOne({ userId: String(user._id) }).lean() : null
  console.log(JSON.stringify({
    trustProductSid: a2p?.trustProductSid,
    trustProductStatus: a2p?.trustProductStatus,
    a2pProfileEndUserSid: a2p?.a2pProfileEndUserSid,
    lastError: a2p?.lastError,
    lastCheckedAt: a2p?.lastCheckedAt,
    lastAdvancedAt: a2p?.lastAdvancedAt,
  }, null, 2))
  await mongoose.disconnect()
}

run().catch(console.error)
