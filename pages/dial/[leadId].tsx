// /pages/dial/[leadId].tsx
import type { GetServerSideProps } from "next";
import { useEffect } from "react";
import { useRouter } from "next/router";

/**
 * Server-side redirect: /dial/:leadId  ->  /lead/:leadId
 * Keeps legacy links working but sends users to the new lead page.
 */
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const leadIdParam = ctx.params?.leadId;
  const leadId =
    Array.isArray(leadIdParam) ? leadIdParam[0] : (leadIdParam as string) || "";

  return {
    redirect: {
      destination: `/lead/${encodeURIComponent(leadId)}`,
      permanent: false,
    },
  };
};

/**
 * Client-side safety net: if someone navigates here without SSR,
 * immediately push them to /lead/:id.
 */
export default function DialRedirect() {
  const router = useRouter();

  useEffect(() => {
    const id = router.query?.leadId;
    if (typeof id === "string" && id) {
      router.replace(`/lead/${encodeURIComponent(id)}`);
    }
  }, [router]);

  return null;
}
