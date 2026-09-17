import type { FormEvent } from "react";
import { useState } from "react";

type TodoInputProps = {
  onAdd: (text: string) => void;
};

export function TodoInput({ onAdd }: TodoInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedValue = value.trim();
    if (trimmedValue === "") {
      event.currentTarget.querySelector("input")?.focus();
      return;
    }
    onAdd(trimmedValue);
    setValue("");
  }

  return (
    <form className="todo-input" onSubmit={handleSubmit}>
      <input
        aria-label="New todo"
        placeholder="What needs to be done?"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit">Add</button>
    </form>
  );
}
