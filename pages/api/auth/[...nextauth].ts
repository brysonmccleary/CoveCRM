import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import clientPromise from "../../../lib/mongodb";
import bcrypt from "bcryptjs";

export default NextAuth({
  adapter: MongoDBAdapter(clientPromise),
  providers: [
    CredentialsProvider({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials) {
          throw new Error("No credentials provided");
        }
        const { email, password } = credentials;

        const db = await clientPromise;
        const user = await db
          .db()
          .collection("users")
          .findOne({ email });

        if (!user) {
          throw new Error("No user found");
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          throw new Error("Invalid password");
        }

        return { id: user._id.toString(), email: user.email };
      }
    })
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin"
  },
  secret: process.env.NEXTAUTH_SECRET
});

