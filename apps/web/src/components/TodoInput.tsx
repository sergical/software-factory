import type { FormEvent } from "react";
import { useRef, useState } from "react";

type TodoInputProps = {
  onAdd: (text: string) => void;
};

export function TodoInput({ onAdd }: TodoInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedValue = value.trim();
    if (trimmedValue === "") {
      inputRef.current?.focus();
      return;
    }
    onAdd(trimmedValue);
    setValue("");
  }

  return (
    <form className="todo-input" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        aria-label="New todo"
        placeholder="What needs to be done?"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit">Add</button>
    </form>
  );
}
