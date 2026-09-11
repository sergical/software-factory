export function newId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100)}`;
}
