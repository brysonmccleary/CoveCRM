import { useEffect, useState } from "react";

export default function ROIDashboard() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/facebook/stats")
      .then((res) => res.json())
      .then((d) => setData(d.campaigns || []));
  }, []);

  return (
    <div style={{ padding: 30 }}>
      <h1>ROI Dashboard</h1>

      <table style={{ width: "100%", marginTop: 20, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Spend</th>
            <th>Leads</th>
            <th>CPL</th>
            <th>Contacts</th>
            <th>Appointments</th>
            <th>Cost / Appt</th>
            <th>Sold</th>
            <th>Revenue</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c, i) => (
            <tr key={i} style={{ textAlign: "center", borderTop: "1px solid #ccc" }}>
              <td>{c.campaignName}</td>
              <td>${c.spend?.toFixed(2)}</td>
              <td>{c.leads}</td>
              <td>${c.cpl?.toFixed(2)}</td>
              <td>{c.contacts}</td>
              <td>{c.appointments}</td>
              <td>${c.costPerAppt?.toFixed(2)}</td>
              <td>{c.sold}</td>
              <td>${c.revenue?.toFixed(2)}</td>
              <td>{(c.roi * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
