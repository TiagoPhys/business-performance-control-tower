import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionPlanPage, isOverdue } from "@/pages/ActionPlanPage";
import { renderWithProviders } from "@/test/render";
import { type ActionItem, loadActions, saveActions, STORAGE_KEY, validateDraft } from "./storage";

vi.mock("@/api/client", async (original) => {
  const actual = await original<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      insights: vi.fn().mockResolvedValue({
        data: { items: [{ id: "region-lowest-margin-central", title: "Central has the lowest profit margin" }] },
        meta: {},
      }),
    },
  };
});

const item: ActionItem = {
  id: "a1",
  title: "Review Central pricing",
  assignee: "Ops lead",
  priority: "high",
  deadline: "2026-01-31",
  status: "in_progress",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("action plan storage", () => {
  it("persists and reloads valid items", () => {
    expect(saveActions([item])).toBe(true);
    expect(loadActions()).toEqual([item]);
  });

  it("drops corrupted or tampered entries instead of crashing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadActions()).toEqual([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item, { ...item, id: "a2", priority: "urgent" }, "x"]));
    expect(loadActions()).toEqual([item]);
  });

  it("validates drafts", () => {
    expect(validateDraft({ title: " ", assignee: "", priority: "low", deadline: "", status: "not_started" })).toEqual({
      title: "Enter a title.",
      assignee: "Enter who owns this action.",
      deadline: "Choose a deadline.",
    });
  });

  it("flags overdue items unless done", () => {
    expect(isOverdue(item, "2026-02-01")).toBe(true);
    expect(isOverdue({ ...item, status: "done" }, "2026-02-01")).toBe(false);
  });
});

describe("ActionPlanPage", () => {
  it("adds an action and keeps it in localStorage", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActionPlanPage />, { route: "/actions" });
    await user.click(screen.getByRole("button", { name: "Add action" }));
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "Audit Tables discounts");
    await user.type(screen.getByLabelText("Assignee"), "Furniture category manager");
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2026-12-15" } });
    await user.click(screen.getByRole("button", { name: "Add action" }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Audit Tables discounts")).toBeInTheDocument();
    expect(loadActions()).toMatchObject([{ title: "Audit Tables discounts", priority: "medium", status: "not_started" }]);
  });

  it("prefills the title from a linked insight", async () => {
    renderWithProviders(<ActionPlanPage />, { route: "/actions?insight=region-lowest-margin-central" });
    expect(await screen.findByDisplayValue("Follow up: Central has the lowest profit margin")).toBeInTheDocument();
  });
});
