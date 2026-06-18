
require("dotenv").config({ path: ".env.local" });

const mongoose = require("mongoose");

const bcrypt = require("bcryptjs");



const EMAIL = "bryson.mccleary1@gmail.com";

const PASSWORD = process.argv[2];



(async () => {

  await mongoose.connect(process.env.MONGODB_URI, {

    dbName: process.env.MONGODB_DBNAME || undefined,

  });



  const user = await mongoose.connection.db.collection("users").findOne(

    { email: EMAIL },

    { projection: { email: 1, password: 1 } }

  );



  console.log({

    dbHost: mongoose.connection.host,

    dbName: mongoose.connection.name,

    found: !!user,

    hashStarts: user?.password?.slice?.(0, 4),

    hashLength: user?.password?.length,

    bcryptCompare: user?.password ? await bcrypt.compare(PASSWORD, user.password) : null,

  });



  await mongoose.disconnect();

})();

