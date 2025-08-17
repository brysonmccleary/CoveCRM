// /pages/login.tsx
import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const cb = typeof ctx.query.callbackUrl === "string" ? ctx.query.callbackUrl : "/dashboard";
  return {
    redirect: {
      destination: `/auth/signin?callbackUrl=${encodeURIComponent(cb)}`,
      permanent: false,
    },
  };
};

export default function LoginRedirect() {
  return null;
}
