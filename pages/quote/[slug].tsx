
import { GetServerSideProps } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Funnel from "@/models/Funnel";
import { useState } from "react";

export default function FunnelPage({ funnel }: any) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    state: ""
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      const res = await fetch("/api/funnel/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          slug: funnel.slug,
          ...form
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Submission failed");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error");
    }
  };

  if (submitted) {
    return (
      <div style={{ padding: 30, fontFamily: "Arial", textAlign: "center" }}>
        <h1>You're all set.</h1>
        <p>An agent will be reaching out shortly.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Arial", background: "#f5f7fb", minHeight: "100vh" }}>
      <div style={{ maxWidth: 500, margin: "0 auto", padding: 20 }}>
        <h1 style={{ fontSize: 26, marginBottom: 10 }}>
          {funnel.headline || "See What You May Qualify For"}
        </h1>

        <p style={{ marginBottom: 20 }}>
          {funnel.subheadline || "Takes less than 60 seconds to check your options."}
        </p>

        <div style={{ background: "white", padding: 20, borderRadius: 10 }}>
          <input
            placeholder="First Name"
            style={inputStyle}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <input
            placeholder="Last Name"
            style={inputStyle}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <input
            placeholder="Phone"
            style={inputStyle}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            placeholder="Email"
            style={inputStyle}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            placeholder="State"
            style={inputStyle}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
          />

          <button style={buttonStyle} onClick={submit}>
            See My Options
          </button>

          {error && <p style={{ color: "red" }}>{error}</p>}

          <p style={{ fontSize: 12, marginTop: 15 }}>
            {funnel.disclaimerText}
          </p>

          {funnel.agentName && (
            <p style={{ fontSize: 12, marginTop: 10 }}>
              Agent: {funnel.agentName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: 12,
  marginBottom: 10,
  borderRadius: 6,
  border: "1px solid #ccc"
};

const buttonStyle = {
  width: "100%",
  padding: 14,
  borderRadius: 6,
  border: "none",
  background: "#2563eb",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer"
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  await mongooseConnect();

  const { slug } = context.params as { slug: string };

  const funnel = await Funnel.findOne({ slug, isActive: true }).lean();

  if (!funnel) {
    return {
      notFound: true
    };
  }

  return {
    props: {
      funnel: JSON.parse(JSON.stringify(funnel))
    }
  };
};
