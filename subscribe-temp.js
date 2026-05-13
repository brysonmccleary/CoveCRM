require('dotenv').config({path: '.env.local'});

async function run() {
  const fetch = (await import('node-fetch')).default;
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await mongoose.connection.db.collection('users').findOne({email: 'bryson.mccleary1@gmail.com'});
  const userToken = user.metaAccessToken;
  const pageId = user.metaPageId;

  // Check token permissions
  const permResp = await fetch('https://graph.facebook.com/v19.0/me/permissions?access_token=' + userToken);
  const permData = await permResp.json();
  console.log('permissions:', JSON.stringify(permData?.data?.filter(p => p.status === 'granted').map(p => p.permission)));
  process.exit();
}
run().catch(e => { console.error(e); process.exit(1); });
