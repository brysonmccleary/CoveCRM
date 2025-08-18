export default function AcceptableUsePolicy() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Acceptable Use Policy</h1>
      <p className="mb-4">Effective Date: July 22, 2025</p>
      <p className="mb-4">
        By using CRM Cove, you agree to use the platform responsibly and in
        accordance with all applicable laws and regulations.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        1. Prohibited Activities
      </h2>
      <ul className="list-disc ml-6 mb-4">
        <li>Sending spam or unsolicited messages (SMS or email)</li>
        <li>Violating TCPA, CAN-SPAM, or A2P 10DLC guidelines</li>
        <li>Harvesting contact information without consent</li>
        <li>Impersonating others or misrepresenting your identity</li>
        <li>Engaging in harassment, threats, or abusive behavior</li>
        <li>Uploading malware, viruses, or harmful content</li>
        <li>Using automation to bypass system limits or abuse tools</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6 mb-2">2. Enforcement</h2>
      <p className="mb-4">
        Violations may result in suspension or termination of your account
        without refund. We reserve the right to report unlawful activity to
        authorities.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        3. Compliance Responsibility
      </h2>
      <p className="mb-4">
        It is your responsibility to ensure all messages comply with recipient
        opt-in requirements and local communication laws.
      </p>
    </div>
  );
}
