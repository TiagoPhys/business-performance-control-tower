/**
 * Action plan persistence in localStorage (this browser only). Stored data is
 * validated on read: malformed entries are dropped instead of crashing the page.
 */

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const STATUSES = ["not_started", "in_progress", "blocked", "done"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
export const STATUS_LABELS: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export interface ActionItem {
  id: string;
  title: string;
  assignee: string;
  priority: Priority;
  /** ISO date (YYYY-MM-DD). */
  deadline: string;
  status: Status;
  /** Pipeline insight this action responds to, if any. */
  insightId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ActionDraft = Pick<ActionItem, "title" | "assignee" | "priority" | "deadline" | "status" | "insightId">;

export const STORAGE_KEY = "bpct.actionPlan.v1";
export const MAX_TITLE = 160;
export const MAX_ASSIGNEE = 80;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isString = (v: unknown): v is string => typeof v === "string";

export function isActionItem(value: unknown): value is ActionItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isString(v.id) &&
    isString(v.title) && v.title.trim().length > 0 && v.title.length <= MAX_TITLE &&
    isString(v.assignee) && v.assignee.length <= MAX_ASSIGNEE &&
    PRIORITIES.includes(v.priority as Priority) &&
    STATUSES.includes(v.status as Status) &&
    isString(v.deadline) && DATE.test(v.deadline) &&
    (v.insightId === undefined || isString(v.insightId)) &&
    isString(v.createdAt) && isString(v.updatedAt)
  );
}

/** Validate a draft; returns field errors (empty when valid). */
export function validateDraft(draft: ActionDraft): Partial<Record<keyof ActionDraft, string>> {
  const errors: Partial<Record<keyof ActionDraft, string>> = {};
  if (!draft.title.trim()) errors.title = "Enter a title.";
  else if (draft.title.length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters.`;
  if (!draft.assignee.trim()) errors.assignee = "Enter who owns this action.";
  else if (draft.assignee.length > MAX_ASSIGNEE) errors.assignee = `Keep the name under ${MAX_ASSIGNEE} characters.`;
  if (!DATE.test(draft.deadline) || Number.isNaN(Date.parse(draft.deadline))) errors.deadline = "Choose a deadline.";
  return errors;
}

export function loadActions(storage: Storage | undefined = safeStorage()): ActionItem[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isActionItem) : [];
  } catch {
    return [];
  }
}

export function saveActions(items: ActionItem[], storage: Storage | undefined = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false; // quota exceeded or storage disabled
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
