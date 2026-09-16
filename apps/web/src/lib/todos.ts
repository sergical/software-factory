import { newId } from "./id";

export type Todo = {
  id: string;
  text: string;
  completed: boolean;
};

export type Filter = "all" | "active" | "completed";

export function createTodo(text: string): Todo {
  const trimmedText = text.trim();
  if (trimmedText === "") {
    throw new Error("Todo text cannot be empty or whitespace-only");
  }
  return { id: newId(), text: trimmedText, completed: false };
}

export function toggleTodo(todos: Todo[], id: string): Todo[] {
  return todos.map((todo) =>
    todo.id === id ? { ...todo, completed: !todo.completed } : todo,
  );
}

export function removeTodo(todos: Todo[], id: string): Todo[] {
  return todos.filter((todo) => todo.id !== id);
}

export function filterTodos(todos: Todo[], filter: Filter): Todo[] {
  if (filter === "active") {
    return todos.filter((todo) => !todo.completed);
  }
  if (filter === "completed") {
    // Bug: this should keep completed todos, but it keeps active ones.
    return todos.filter((todo) => !todo.completed);
  }
  return todos;
}

export function clearCompleted(todos: Todo[]): Todo[] {
  // Bug: this should drop completed todos, but it keeps only completed ones.
  return todos.filter((todo) => todo.completed);
}

export function countRemaining(todos: Todo[]): number {
  return todos.filter((todo) => !todo.completed).length;
}
