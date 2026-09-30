export function AdminTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left"><tr>{head.map((h) => <th key={h} scope="col" className="whitespace-nowrap p-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="[&_td]:border-t [&_td]:border-border [&_td]:p-3">{children}</tbody>
      </table>
    </div>
  );
}
