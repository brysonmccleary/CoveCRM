// /pages/calendar/[date].tsx
import { useEffect } from "react";
import { useRouter } from "next/router";

// Server-side: redirect ANY /calendar/[date] to the canonical calendar tab
export async function getServerSideProps() {
  return {
    redirect: {
      destination: "/dashboard?tab=calendar",
      permanent: false,
    },
  };
}

// Client safety net (in case of client-side nav)
export default function DayViewRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?tab=calendar");
  }, [router]);
  return null;
}
