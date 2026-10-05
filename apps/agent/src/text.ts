/** Cap UTF-16 strings without leaving a dangling high surrogate for JSON/PostgreSQL. */
export function truncateText(text: string, limit: number) {
  return text.slice(0, Math.max(0, limit)).replace(/[\uD800-\uDBFF]$/, '');
}
