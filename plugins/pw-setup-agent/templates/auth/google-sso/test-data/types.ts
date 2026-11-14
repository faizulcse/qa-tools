/** A Google account used to sign in. Empty strings mean "not set". */
export interface GoogleAccount {
  /** Account email. Without it, sign-in is finished by hand in Chrome. */
  email: string;
  /** Optional. Without it, the password step is finished by hand. */
  password: string;
  /** Optional fixed 2-Step code, entered if Google asks for one. */
  otp: string;
}
