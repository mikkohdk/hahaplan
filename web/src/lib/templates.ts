/**
 * Reusable lineup templates, stored in the host's browser (localStorage).
 * Server-independent: a template survives even if the show server resets, so
 * it's the tool for recurring nights and rebuilding after a false start.
 */
import type { Act } from "../../../shared/protocol";

export interface Template {
  id: string;
  name: string;
  acts: Act[];
  savedAtMs: number;
}

const KEY = "hahaplan.templates.v1";

export function loadTemplates(): Template[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Template[]) : [];
  } catch {
    return [];
  }
}

function persist(list: Template[]): Template[] {
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

/** Save the current lineup; a same-named template is replaced (in-place edit). */
export function saveTemplate(name: string, acts: Act[]): Template[] {
  const tpl: Template = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled template",
    acts,
    savedAtMs: Date.now(),
  };
  const rest = loadTemplates().filter((t) => t.name !== tpl.name);
  return persist([tpl, ...rest]);
}

export function deleteTemplate(id: string): Template[] {
  return persist(loadTemplates().filter((t) => t.id !== id));
}

/** Fresh act ids so a loaded template never collides with existing acts. */
export function templateActs(tpl: Template): Act[] {
  return tpl.acts.map((a) => ({ ...a, id: crypto.randomUUID() }));
}
