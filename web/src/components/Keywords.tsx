import type { Keyword } from "../../../shared/protocol";

const GROUPS: { label: string; cat: Keyword["category"] }[] = [
  { label: "Locations", cat: "location" },
  { label: "Professions", cat: "profession" },
];

/** Captured keywords, grouped by category, as tag chips. */
export function Keywords({ keywords }: { keywords: Keyword[] }) {
  return (
    <div className="kw-groups">
      {GROUPS.map(({ label, cat }) => {
        const items = keywords.filter((k) => k.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            <div className="text-overline">{label}</div>
            <div
              className="row row--wrap"
              style={{ marginTop: "var(--space-2)", gap: "var(--space-2)" }}
            >
              {items.map((k) => (
                <span key={k.term} className="mg-tag">
                  {k.term}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
