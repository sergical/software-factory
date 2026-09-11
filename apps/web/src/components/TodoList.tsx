import type { Todo } from "../lib/todos";

type TodoListProps = {
  todos: Todo[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
};

export function TodoList({ todos, onToggle, onRemove }: TodoListProps) {
  if (todos.length === 0) {
    return <p className="todo-list-empty">No todos</p>;
  }

  return (
    <ul className="todo-list">
      {todos.map((todo) => (
        <li key={todo.id} className="todo-item">
          <label>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => onToggle(todo.id)}
            />
            <span className={todo.completed ? "completed" : undefined}>
              {todo.text}
            </span>
          </label>
          <button
            type="button"
            aria-label={`Remove ${todo.text}`}
            onClick={() => onRemove(todo.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
