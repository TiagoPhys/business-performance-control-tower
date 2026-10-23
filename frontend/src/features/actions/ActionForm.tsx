import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type ActionDraft,
  MAX_ASSIGNEE,
  MAX_TITLE,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUSES,
  validateDraft,
} from "./storage";

export const EMPTY_DRAFT: ActionDraft = { title: "", assignee: "", priority: "medium", deadline: "", status: "not_started" };

export function ActionForm({
  initial = EMPTY_DRAFT,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ActionDraft;
  submitLabel: string;
  onSubmit: (draft: ActionDraft) => void;
  onCancel?: () => void;
}) {
  const ids = { title: useId(), assignee: useId(), priority: useId(), deadline: useId(), status: useId() };
  const [draft, setDraft] = useState<ActionDraft>(initial);
  const [errors, setErrors] = useState<ReturnType<typeof validateDraft>>({});

  const set = <K extends keyof ActionDraft>(key: K, value: ActionDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      onSubmit({ ...draft, title: draft.title.trim(), assignee: draft.assignee.trim() });
      if (!onCancel) setDraft(EMPTY_DRAFT);
    }
  };

  const errorText = (key: keyof ActionDraft, id: string) =>
    errors[key] ? (
      <p id={`${id}-error`} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <Label htmlFor={ids.title}>Title</Label>
        <Input id={ids.title} value={draft.title} maxLength={MAX_TITLE} onChange={(e) => set("title", e.target.value)}
          aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? `${ids.title}-error` : undefined} />
        {errorText("title", ids.title)}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.assignee}>Assignee</Label>
        <Input id={ids.assignee} value={draft.assignee} maxLength={MAX_ASSIGNEE}
          onChange={(e) => set("assignee", e.target.value)} aria-invalid={Boolean(errors.assignee)}
          aria-describedby={errors.assignee ? `${ids.assignee}-error` : undefined} />
        {errorText("assignee", ids.assignee)}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.priority}>Priority</Label>
        <Select value={draft.priority} onValueChange={(v) => set("priority", v as ActionDraft["priority"])}>
          <SelectTrigger id={ids.priority} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.deadline}>Deadline</Label>
        <Input id={ids.deadline} type="date" value={draft.deadline} onChange={(e) => set("deadline", e.target.value)}
          aria-invalid={Boolean(errors.deadline)} aria-describedby={errors.deadline ? `${ids.deadline}-error` : undefined} />
        {errorText("deadline", ids.deadline)}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.status}>Status</Label>
        <Select value={draft.status} onValueChange={(v) => set("status", v as ActionDraft["status"])}>
          <SelectTrigger id={ids.status} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
        <Button type="submit">{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
