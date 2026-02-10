/** Returns a persistent anonymous user UUID from localStorage, creating one if absent. */
export function getUserId(): string {
  let id = localStorage.getItem('echo_uid');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('echo_uid', id);
  }
  return id;
}
