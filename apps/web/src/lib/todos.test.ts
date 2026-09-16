import { describe, expect, it } from "vitest";
import {
  clearCompleted,
  countRemaining,
  createTodo,
  filterTodos,
  removeTodo,
  type Todo,
  toggleTodo,
} from "./todos";

function makeTodos(): Todo[] {
  return [
    { id: "1", text: "buy milk", completed: false },
    { id: "2", text: "walk dog", completed: true },
    { id: "3", text: "write code", completed: false },
  ];
}

describe("createTodo", () => {
  it("creates a todo with the given text and completed false", () => {
    const todo = createTodo("buy milk");
    expect(todo.text).toBe("buy milk");
    expect(todo.completed).toBe(false);
    expect(todo.id.length).toBeGreaterThan(0);
  });

  it("throws an error if the input text is whitespace-only", () => {
    expect(() => createTodo("   ")).toThrow(
      "Todo text cannot be empty or whitespace-only",
    );
  });
});

describe("toggleTodo", () => {
  it("flips completed for the matching id", () => {
    const todos = makeTodos();
    const result = toggleTodo(todos, "1");
    expect(result.find((t) => t.id === "1")?.completed).toBe(true);
  });

  it("leaves other todos unchanged", () => {
    const todos = makeTodos();
    const result = toggleTodo(todos, "1");
    expect(result.find((t) => t.id === "2")?.completed).toBe(true);
    expect(result.find((t) => t.id === "3")?.completed).toBe(false);
  });
});

describe("removeTodo", () => {
  it("removes the todo with the matching id", () => {
    const result = removeTodo(makeTodos(), "2");
    expect(result.map((t) => t.id)).toEqual(["1", "3"]);
  });
});

describe("filterTodos", () => {
  it("returns all todos for the all filter", () => {
    expect(filterTodos(makeTodos(), "all")).toHaveLength(3);
  });

  it("returns only active todos for the active filter", () => {
    const result = filterTodos(makeTodos(), "active");
    expect(result.map((t) => t.id)).toEqual(["1", "3"]);
  });

  // Seeded bug: the completed filter currently returns active todos
  // instead of completed ones. See ISSUES.md.
  it("currently returns active todos for the completed filter (seeded bug)", () => {
    const result = filterTodos(makeTodos(), "completed");
    expect(result.map((t) => t.id)).toEqual(["1", "3"]);
  });
});

describe("clearCompleted", () => {
  // Seeded bug: this currently keeps only completed todos instead of
  // dropping them. See ISSUES.md.
  it("currently keeps only completed todos (seeded bug)", () => {
    const result = clearCompleted(makeTodos());
    expect(result.map((t) => t.id)).toEqual(["2"]);
  });
});

describe("countRemaining", () => {
  it("counts todos that are not completed", () => {
    expect(countRemaining(makeTodos())).toBe(2);
  });
});
