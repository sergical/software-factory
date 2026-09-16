24:           <button
25:             key={option}
26:             type="button"
27:             className={option === filter ? "active" : undefined}
28:             onClick={() => onFilterChange(option)}
29:             aria-pressed={option === filter}
30:             {option}
31:           </button>
32:         ))}
33:       </div>
34:       <button type="button" onClick={onClearCompleted}>
35:         Clear completed
36:       </button>
37:     </footer>
38:   );
39: }