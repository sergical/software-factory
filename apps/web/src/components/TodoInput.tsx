import type { FormEvent } from "react";
import { useState } from "react";

type TodoInputProps = {
  onAdd: (text: string) => void;
};

export function TodoInput({ onAdd }: TodoInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Bug: this only blocks a fully empty string, not whitespace-only
    // input, and does not trim the value before adding it.
    if (value === "") {
      return;
    }
    onAdd(value);
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
