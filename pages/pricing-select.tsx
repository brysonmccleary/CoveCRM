import { useEffect } from "react";

export default function PricingSelectRedirect() {
  useEffect(() => {
    const query = window.location.search || "";
    window.location.href = `/${query}#pricing`;
  }, []);

  return null;
}
