import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface Invoice {
  id: string;
  amountPaid: number;
  date: string;
  hostedInvoiceUrl: string;
  receiptUrl: string | null;
  description: string;
  status: string;
}

interface AffiliateStats {
  totalEarned: number;
  thisMonth: number;
  lastPayout: string | null;
  history?: {
    month: string;
    value: number;
  }[];
}

export default function InvoicesPanel() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [affiliateStats, setAffiliateStats] = useState<AffiliateStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [invoiceRes, payoutRes] = await Promise.all([
          fetch("/api/invoices"),
          fetch("/api/invoices/affiliate-payouts"),
        ]);

        const invoicesData = await invoiceRes.json();
        const payoutsData = await payoutRes.json();

        if (!invoiceRes.ok) throw new Error(invoicesData.message || "Invoice fetch failed");
        if (!payoutRes.ok) throw new Error(payoutsData.message || "Affiliate payout fetch failed");

        setInvoices(invoicesData.invoices || []);
        if (payoutsData.payouts && payoutsData.payouts.length > 0) {
          setAffiliateStats(payoutsData.payouts[0]);
        }
      } catch (err: any) {
        toast.error(err.message || "Failed to fetch billing or affiliate data.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="space-y-10 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold mb-2">Your Stripe Invoices</h2>
        {loading && <p className="text-gray-400">Loading invoices...</p>}

        {!loading && invoices.length === 0 && (
          <p className="text-gray-400">No invoices found.</p>
        )}

        {!loading && invoices.length > 0 && (
          <table className="min-w-full bg-[#1e293b] border border-gray-700 rounded-md text-sm">
            <thead>
              <tr className="bg-[#334155] text-left font-semibold text-white">
                <th className="p-3 border-b border-gray-700">Date</th>
                <th className="p-3 border-b border-gray-700">Amount</th>
                <th className="p-3 border-b border-gray-700">Status</th>
                <th className="p-3 border-b border-gray-700">Description</th>
                <th className="p-3 border-b border-gray-700">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-[#2d3e52] transition">
                  <td className="p-3 border-b border-gray-700">
                    {new Date(invoice.date).toLocaleDateString()}
                  </td>
                  <td className="p-3 border-b border-gray-700">
                    ${invoice.amountPaid.toFixed(2)}
                  </td>
                  <td className="p-3 border-b border-gray-700 capitalize">
                    {invoice.status}
                  </td>
                  <td className="p-3 border-b border-gray-700">
                    {invoice.description}
                  </td>
                  <td className="p-3 border-b border-gray-700">
                    {invoice.receiptUrl ? (
                      <a
                        href={invoice.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline"
                      >
                        View
                      </a>
                    ) : (
                      "N/A"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {affiliateStats && (
        <div className="bg-[#1e293b] border border-gray-700 rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold">Affiliate Payout History</h2>
          <div className="text-sm text-gray-300">
            <p>
              <span className="font-semibold text-white">Total Earned:</span>{" "}
              ${affiliateStats.totalEarned.toFixed(2)}
            </p>
            <p>
              <span className="font-semibold text-white">This Month:</span>{" "}
              ${affiliateStats.thisMonth.toFixed(2)}
            </p>
            <p>
              <span className="font-semibold text-white">Last Payout:</span>{" "}
              {affiliateStats.lastPayout
                ? new Date(affiliateStats.lastPayout).toLocaleDateString()
                : "Not yet paid out"}
            </p>
          </div>

          {affiliateStats.history && affiliateStats.history.length > 0 && (
            <div className="pt-4">
              <h3 className="text-md font-semibold text-white mb-2">Monthly Breakdown</h3>
              <table className="min-w-full bg-[#1e293b] border border-gray-700 text-sm">
                <thead>
                  <tr className="bg-[#334155] text-white text-left">
                    <th className="p-3 border-b border-gray-700">Month</th>
                    <th className="p-3 border-b border-gray-700">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {affiliateStats.history.map(({ month, value }) => (
                    <tr key={month} className="hover:bg-[#2d3e52] transition">
                      <td className="p-3 border-b border-gray-700">
                        {new Date(month + "-01").toLocaleString("default", {
                          month: "long",
                          year: "numeric",
                        })}
                      </td>
                      <td className="p-3 border-b border-gray-700">
                        ${value.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
