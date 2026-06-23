/**
 * Local single-user stand-in.
 *
 * Clerk (third-party auth) was removed — the app no longer has login. Every
 * request runs as one fixed local user so the existing ownership model
 * (projects keyed by user id) keeps working unchanged.
 */
export const LOCAL_USER_ID = "local-user";
export const LOCAL_USER_EMAIL = "local@local";

/** The current (only) user. Replaces Clerk's auth()/currentUser(). */
export function getLocalUser() {
  return { userId: LOCAL_USER_ID, email: LOCAL_USER_EMAIL };
}
