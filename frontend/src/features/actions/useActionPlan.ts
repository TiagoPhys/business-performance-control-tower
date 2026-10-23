import { useCallback, useEffect, useState } from "react";
import { type ActionDraft, type ActionItem, loadActions, newId, saveActions, STORAGE_KEY } from "./storage";

/** Action plan state persisted to localStorage and kept in sync across tabs. */
export function useActionPlan() {
  const [items, setItems] = useState<ActionItem[]>(() => loadActions());
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setItems(loadActions());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((update: (current: ActionItem[]) => ActionItem[]) => {
    setItems((current) => {
      const next = update(current);
      setSaveFailed(!saveActions(next));
      return next;
    });
  }, []);

  const add = useCallback(
    (draft: ActionDraft) => {
      const now = new Date().toISOString();
      commit((current) => [...current, { ...draft, id: newId(), createdAt: now, updatedAt: now }]);
    },
    [commit],
  );

  const update = useCallback(
    (id: string, patch: Partial<ActionDraft>) =>
      commit((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)),
      ),
    [commit],
  );

  const remove = useCallback((id: string) => commit((current) => current.filter((item) => item.id !== id)), [commit]);

  return { items, add, update, remove, saveFailed };
}
