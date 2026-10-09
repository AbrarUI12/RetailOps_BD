/** Mirrors the server's minimum policy (backend/app/core/security.py) for instant feedback. */
export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblems(password: string) {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) problems.push("Mix letters and numbers");
  return problems;
}
