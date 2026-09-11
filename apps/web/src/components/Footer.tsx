import type { Filter } from "../lib/todos";

type FooterProps = {
  remaining: number;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  onClearCompleted: () => void;
};

const FILTERS: Filter[] = ["all", "active", "completed"];

export function Footer({
  remaining,
  filter,
  onFilterChange,
  onClearCompleted,
}: FooterProps) {
  return (
    <footer className="footer">
      {/* Bug: should pluralise "item" when remaining !== 1. */}
      <span className="count">{remaining} items left</span>
      <div className="filters">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={option === filter ? "active" : undefined}
            onClick={() => onFilterChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <button type="button" onClick={onClearCompleted}>
        Clear completed
      </button>
    </footer>
  );
}
