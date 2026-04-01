import { useEffect, useState } from "react";

export default function RecommendationsDashboard() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/facebook/recommendations")
      .then((res) => res.json())
      .then((d) => setData(d.campaigns || []));
  }, []);

  return (
    <div style={{ padding: 30 }}>
      <h1>AI Recommendations</h1>

      {data.map((c, i) => (
        <div key={i} style={{ border: "1px solid #333", padding: 20, marginTop: 20 }}>
          <h2>{c.campaignName}</h2>

          <p>Spend: ${c.stats.spend?.toFixed(2)}</p>
          <p>Leads: {c.stats.leads}</p>
          <p>CPL: ${c.stats.cpl?.toFixed(2)}</p>
          <p>Appointments: {c.stats.appointments}</p>
          <p>ROI: {(c.stats.roi * 100).toFixed(1)}%</p>

          <h3>Recommendations:</h3>
          <ul>
            {c.recommendations.map((r: string, idx: number) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>

          <div style={{ marginTop: 10 }}>
            <button style={{ marginRight: 10 }}>Pause</button>
            <button style={{ marginRight: 10 }}>Increase Budget</button>
            <button style={{ marginRight: 10 }}>Duplicate</button>
            <button style={{ marginRight: 10 }}>Edit Ad</button>
            <button>Change Script</button>
          </div>
        </div>
      ))}
    </div>
  );
}
