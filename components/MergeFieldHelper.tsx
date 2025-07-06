interface Props {
  onInsert: (value: string) => void;
}

export default function MergeFieldHelper({ onInsert }: Props) {
  const fields = [
    "{{ contact.first_name }}",
    "{{ agent.name }}",
    "{{ contact.last_name }}",
    "{{ contact.email }}"
  ];

  return (
    <div className="mb-2">
      <label className="mr-2 font-semibold">Insert field:</label>
      <select
        onChange={(e) => {
          if (e.target.value !== "") {
            onInsert(e.target.value);
            e.target.value = "";
          }
        }}
        className="border p-1 rounded"
      >
        <option value="">Select...</option>
        {fields.map((field) => (
          <option key={field} value={field}>
            {field}
          </option>
        ))}
      </select>
    </div>
  );
}
