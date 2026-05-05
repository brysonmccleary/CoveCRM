import mongoose from 'mongoose'
import User from './models/User'
import A2PProfile from './models/A2PProfile'
import { getClientForUser } from './lib/twilio/getClientForUser'

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || '')

  const email = 'aliciaandrade.ffl@gmail.com'
  const user = await User.findOne({ email }).lean()
  const a2p = user ? await A2PProfile.findOne({ userId: String(user._id) }).lean() : null
  if (!a2p?.trustProductSid) throw new Error('No trust product')

  const resolved = await getClientForUser(email)
  const tp: any = await resolved.client.trusthub.v1
    .trustProducts(a2p.trustProductSid)
    .fetch()

  console.log(JSON.stringify(tp, null, 2))

  await mongoose.disconnect()
}

run().catch(console.error)
