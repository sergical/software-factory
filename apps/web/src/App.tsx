import { useState } from "react";
import { Footer } from "./components/Footer";
import { TodoInput } from "./components/TodoInput";
import { TodoList } from "./components/TodoList";
import {
  clearCompleted,
  countRemaining,
  createTodo,
  type Filter,
  filterTodos,
  removeTodo,
  type Todo,
  toggleTodo,
} from "./lib/todos";

// Gap: todos live only in React state and are lost on reload. See
// ISSUES.md for the request to persist them in localStorage.
export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<Filter>("all");

  function handleAdd(text: string) {
    setTodos((current) => [...current, createTodo(text)]);
  }

  function handleToggle(id: string) {
    setTodos((current) => toggleTodo(current, id));
  }

  function handleRemove(id: string) {
    setTodos((current) => removeTodo(current, id));
  }

  function handleClearCompleted() {
    setTodos((current) => clearCompleted(current));
  }

  const visibleTodos = filterTodos(todos, filter);

  return (
    <main className="app">
      <h1>Todo</h1>
      <TodoInput onAdd={handleAdd} />
      <TodoList
        todos={visibleTodos}
        onToggle={handleToggle}
        onRemove={handleRemove}
      />
      <Footer
        remaining={countRemaining(todos)}
        filter={filter}
        onFilterChange={setFilter}
        onClearCompleted={handleClearCompleted}
      />
    </main>
  );
}
