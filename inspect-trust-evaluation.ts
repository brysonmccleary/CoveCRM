import mongoose from 'mongoose'
import User from './models/User'
import A2PProfile from './models/A2PProfile'
import { getClientForUser } from './lib/twilio/getClientForUser'

function basicAuth(username: string, password: string) {
  return Buffer.from(`${username}:${password}`).toString('base64')
}

async function trusthubGet(auth: any, accountSid: string, path: string) {
  const res = await fetch(`https://trusthub.twilio.com${path}`, {
    headers: {
      Authorization: `Basic ${basicAuth(auth.username, auth.password)}`,
      'X-Twilio-AccountSid': accountSid,
    },
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || '')

  const email = 'aliciaandrade.ffl@gmail.com'
  const user = await User.findOne({ email }).lean()
  const a2p = user ? await A2PProfile.findOne({ userId: String(user._id) }).lean() : null
  if (!a2p?.trustProductSid) throw new Error('No trust product')

  const resolved = await getClientForUser(email)

  console.log('\nEVALUATIONS:')
  console.log(JSON.stringify(
    await trusthubGet(resolved.auth, resolved.accountSid, `/v1/TrustProducts/${a2p.trustProductSid}/Evaluations`),
    null,
    2
  ))

  console.log('\nENTITY ASSIGNMENTS:')
  console.log(JSON.stringify(
    await trusthubGet(resolved.auth, resolved.accountSid, `/v1/TrustProducts/${a2p.trustProductSid}/EntityAssignments`),
    null,
    2
  ))

  await mongoose.disconnect()
}

run().catch(console.error)
