import NextAuth from "next-auth";
declare module "next-auth" {
  interface User {
    id?: string;
    role: "user" | "admin";
    affiliateCode?: string | null;
  }
  interface Session {
    user?: {
      id?: string;
      email?: string | null;
      name?: string | null;
      role?: "user" | "admin";
      affiliateCode?: string | null;
    } | null;
  }
}
export {};
